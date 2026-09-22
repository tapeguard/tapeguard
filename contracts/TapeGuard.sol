// SPDX-License-Identifier: ISC
pragma solidity 0.8.29;

/**
 * @title TapeGuard
 * @notice A correctness layer for tokenised-equity prices.
 *
 * Stores, per instrument, a signed verdict carrying two separate fields:
 *
 *   provenance  where the number came from  (TRADED/DERIVED/STALE/HALTED)
 *   flags       why not to act on it        (a bitfield, several at once)
 *
 * They are separate because they answer different questions. A stock
 * splitting 10:1 tomorrow has a perfect live print today: the provenance is
 * genuinely TRADED and the number becomes incomparable in sixteen hours. A
 * single enum forces a choice between saying TRADED, which is true and
 * dangerous, and STALE, which is false.
 *
 * Reads refuse by default. `getPriceIfSafe` reverts unless the price is a
 * live print with no flag raised, and the revert carries the flags back so
 * the caller learns which guard stopped it rather than just that one did.
 * A caller that understands a particular risk opts into it explicitly with
 * the `allowedFlags` overload.
 */
contract TapeGuard {
    // ---------------------------------------------------------------- types

    struct Verdict {
        uint128 price;            // scaled by PRICE_SCALE
        uint64 publishedAt;       // when this verdict was computed
        uint64 lastTradeTime;     // the print it is anchored to
        uint32 confidenceBps;     // half-width of the band
        uint16 flags;             // risk bitfield
        uint8 provenance;         // 0 TRADED, 1 DERIVED, 2 STALE, 3 HALTED
        uint8 session;            // 0 REGULAR, 1 PRE, 2 POST, 3 CLOSED, 4 HOLIDAY
        uint16 maxDeviationBps;   // observed spread between sources
        uint8 sourceCount;        // how many upstreams resolved
    }

    uint8 public constant PROVENANCE_TRADED = 0;
    uint256 public constant PRICE_SCALE = 1e8;

    /// @dev Outcome codes for a batch post. A failed item is recorded, never thrown.
    uint8 public constant POST_OK = 0;
    uint8 public constant POST_NOT_NEWER = 1;
    uint8 public constant POST_BAD_SIGNATURE = 2;
    uint8 public constant POST_BELOW_THRESHOLD = 3;
    uint8 public constant POST_UNSORTED = 4;
    uint8 public constant POST_FUTURE_DATED = 5;

    /**
     * @notice How far ahead of the chain's clock a verdict may claim to be.
     * @dev Not zero, because a signer's host and the sequencer do not share a
     *      clock and a second of skew is ordinary. Not unbounded, because a
     *      verdict dated far in the future is a permanent denial of service:
     *      the replay guard accepts only something strictly newer, so nothing
     *      could ever replace it, and the ticker would be frozen at that
     *      price until the wall clock caught up. Anyone may relay, so that
     *      freeze is reachable by replaying one signed quote.
     */
    uint64 public constant MAX_FUTURE_SKEW_SEC = 60;

    // --------------------------------------------------------------- errors

    error NotPosted(string ticker);
    error TooOld(string ticker, uint64 age, uint64 maxAge);
    error NotLive(string ticker, uint8 provenance);
    error Flagged(string ticker, uint16 flags, uint16 disallowed);
    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error BadThreshold(uint8 threshold, uint8 signerCount);
    error LengthMismatch();

    // --------------------------------------------------------------- events

    event VerdictPosted(
        string indexed tickerIndexed,
        string ticker,
        uint128 price,
        uint32 confidenceBps,
        uint16 flags,
        uint8 provenance,
        uint8 session,
        uint64 publishedAt,
        address relayer
    );
    event PostRejected(string ticker, uint8 code);
    event SignerSet(address indexed signer, bool allowed);
    event ThresholdSet(uint8 threshold);
    event OwnerSet(address indexed owner);
    event OwnershipOffered(address indexed pendingOwner);

    // ---------------------------------------------------------------- state

    address public owner;
    address public pendingOwner;
    mapping(address => bool) public isSigner;
    uint8 public signerCount;

    /**
     * @notice How many distinct allow-listed signatures a verdict needs.
     * @dev A parameter from the first deployment, not a later upgrade. Raising
     *      it to 2-of-3 is a transaction, not a redeploy — so integrators keep
     *      their address and the published archive is not reset. Adding this
     *      after the fact is what forces an oracle to orphan its consumers.
     */
    uint8 public threshold;

    mapping(bytes32 => Verdict) private _verdicts;
    mapping(bytes32 => bool) private _exists;

    // ------------------------------------------------------------- EIP-712

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 private constant VERDICT_TYPEHASH = keccak256(
        "Verdict(bytes32 ticker,uint128 price,uint64 publishedAt,uint64 lastTradeTime,"
        "uint32 confidenceBps,uint16 flags,uint8 provenance,uint8 session,"
        "uint16 maxDeviationBps,uint8 sourceCount)"
    );

    uint256 private immutable _cachedChainId;
    bytes32 private immutable _cachedDomainSeparator;

    constructor(address initialSigner) {
        owner = msg.sender;
        emit OwnerSet(msg.sender);

        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();

        if (initialSigner != address(0)) {
            isSigner[initialSigner] = true;
            signerCount = 1;
            emit SignerSet(initialSigner, true);
        }
        threshold = 1;
        emit ThresholdSet(1);
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("TapeGuard")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /**
     * @dev Recomputed after a chain split rather than cached blindly. A
     *      signature is scoped to one chain id and one contract address, so a
     *      verdict signed for the testnet deployment cannot be replayed onto
     *      mainnet — which a bare digest over the tuple would permit.
     */
    function domainSeparator() public view returns (bytes32) {
        return block.chainid == _cachedChainId ? _cachedDomainSeparator : _buildDomainSeparator();
    }

    function digest(string calldata ticker, Verdict calldata v) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                VERDICT_TYPEHASH,
                keccak256(bytes(ticker)),
                v.price,
                v.publishedAt,
                v.lastTradeTime,
                v.confidenceBps,
                v.flags,
                v.provenance,
                v.session,
                v.maxDeviationBps,
                v.sourceCount
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    // ------------------------------------------------------------- writing

    /**
     * @notice Post a verdict. Anyone may relay; the contract authenticates the
     *         signatures, not the sender.
     * @param signatures Distinct allow-listed signers, sorted ascending by
     *        recovered address. Sorting is how distinctness is proved in O(n)
     *        without a memory set.
     */
    function postVerdict(string calldata ticker, Verdict calldata v, bytes[] calldata signatures)
        external
    {
        uint8 code = _tryPost(ticker, v, signatures);
        if (code == POST_OK) return;
        if (code == POST_NOT_NEWER) revert("verdict is not newer than stored");
        if (code == POST_FUTURE_DATED) revert("verdict is dated in the future");
        if (code == POST_UNSORTED) revert("signatures not sorted by signer");
        if (code == POST_BELOW_THRESHOLD) revert("below signer threshold");
        revert("signature not from an allow-listed signer");
    }

    /**
     * @notice Post several verdicts in one transaction.
     * @dev A failed item is recorded and skipped, never thrown. Anyone may
     *      relay and the contract rejects anything not strictly newer, so two
     *      relayers racing on one ticker is an ordinary event. Bubbling that
     *      revert would discard the other items and burn the gas anyway.
     *
     *      Landing every instrument in one block also matters more than the
     *      gas: posted separately they land across many, and a consumer
     *      reading mid-round gets a snapshot that never existed at any instant.
     */
    function postVerdicts(
        string[] calldata tickers,
        Verdict[] calldata verdicts,
        bytes[][] calldata signatures
    ) external returns (uint8[] memory codes) {
        if (tickers.length != verdicts.length || tickers.length != signatures.length) {
            revert LengthMismatch();
        }
        codes = new uint8[](tickers.length);
        for (uint256 i = 0; i < tickers.length; i++) {
            codes[i] = _tryPost(tickers[i], verdicts[i], signatures[i]);
        }
    }

    function _tryPost(string calldata ticker, Verdict calldata v, bytes[] calldata signatures)
        private
        returns (uint8)
    {
        bytes32 key = keccak256(bytes(ticker));

        if (_exists[key] && v.publishedAt <= _verdicts[key].publishedAt) {
            emit PostRejected(ticker, POST_NOT_NEWER);
            return POST_NOT_NEWER;
        }
        if (v.publishedAt > uint64(block.timestamp) + MAX_FUTURE_SKEW_SEC) {
            emit PostRejected(ticker, POST_FUTURE_DATED);
            return POST_FUTURE_DATED;
        }
        if (signatures.length < threshold) {
            emit PostRejected(ticker, POST_BELOW_THRESHOLD);
            return POST_BELOW_THRESHOLD;
        }

        bytes32 d = digest(ticker, v);
        address last = address(0);
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = _recover(d, signatures[i]);
            if (signer == address(0) || !isSigner[signer]) {
                emit PostRejected(ticker, POST_BAD_SIGNATURE);
                return POST_BAD_SIGNATURE;
            }
            if (signer <= last) {
                emit PostRejected(ticker, POST_UNSORTED);
                return POST_UNSORTED;
            }
            last = signer;
        }

        _verdicts[key] = v;
        _exists[key] = true;
        emit VerdictPosted(
            ticker, ticker, v.price, v.confidenceBps, v.flags, v.provenance, v.session, v.publishedAt, msg.sender
        );
        return POST_OK;
    }

    function _recover(bytes32 d, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        // Reject the malleable upper-half s, so one authorisation has exactly
        // one valid encoding and cannot be reshaped into a second signature.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        if (v != 27 && v != 28) return address(0);
        return ecrecover(d, v, r, s);
    }

    // ------------------------------------------------------------- reading

    function getVerdict(string calldata ticker) public view returns (Verdict memory) {
        bytes32 key = keccak256(bytes(ticker));
        if (!_exists[key]) revert NotPosted(ticker);
        return _verdicts[key];
    }

    /// @notice The default read: refuses anything that is not a clean live print.
    function getPriceIfSafe(string calldata ticker, uint64 maxAge) external view returns (uint128) {
        return getPriceIfSafe(ticker, maxAge, 0);
    }

    /**
     * @notice Read a price, opting into named risks.
     * @param allowedFlags Bits the caller has decided it understands. Any flag
     *        outside this mask reverts, and the revert names the offenders.
     */
    function getPriceIfSafe(string calldata ticker, uint64 maxAge, uint16 allowedFlags)
        public
        view
        returns (uint128)
    {
        Verdict memory v = getVerdict(ticker);

        // Clamped rather than subtracted blind. Within the accepted skew a
        // verdict can legitimately carry a timestamp a few seconds ahead of
        // the block, and an unchecked subtraction would underflow and panic —
        // turning a harmless clock difference into a ticker no one can read.
        uint64 age =
            v.publishedAt >= uint64(block.timestamp) ? 0 : uint64(block.timestamp) - v.publishedAt;
        if (age > maxAge) revert TooOld(ticker, age, maxAge);
        if (v.provenance != PROVENANCE_TRADED) revert NotLive(ticker, v.provenance);

        uint16 disallowed = v.flags & ~allowedFlags;
        if (disallowed != 0) revert Flagged(ticker, v.flags, disallowed);

        return v.price;
    }

    /**
     * @notice Band edges, computed the same way off chain.
     * @dev Integer arithmetic throughout. In floating point,
     *      `100 * (1 + 50/10_000)` is 100.49999999999999, so a print landing
     *      exactly on a band edge scores as outside it. Those cases are rare
     *      but not random — they cluster where the band is doing its work.
     */
    function getBandedPrice(string calldata ticker) external view returns (uint128 lo, uint128 hi) {
        Verdict memory v = getVerdict(ticker);
        uint256 delta = (uint256(v.price) * v.confidenceBps) / 10_000;
        lo = delta >= v.price ? 0 : uint128(uint256(v.price) - delta);
        hi = uint128(uint256(v.price) + delta);
    }

    /// @notice Batch staleness discovery, for keepers. View, so asking is free.
    function needsUpdate(string[] calldata tickers, uint64 maxAge)
        external
        view
        returns (bool[] memory out)
    {
        out = new bool[](tickers.length);
        for (uint256 i = 0; i < tickers.length; i++) {
            bytes32 key = keccak256(bytes(tickers[i]));
            // Never posted counts as needing an update, which is what it needs.
            // One unknown symbol must not blind a keeper to the others.
            uint64 publishedAt = _verdicts[key].publishedAt;
            uint64 age =
                publishedAt >= uint64(block.timestamp) ? 0 : uint64(block.timestamp) - publishedAt;
            out[i] = !_exists[key] || age > maxAge;
        }
    }

    // ---------------------------------------------------------------- admin

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setSigner(address signer, bool allowed) external onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        if (isSigner[signer] == allowed) return;

        uint8 next = allowed ? signerCount + 1 : signerCount - 1;
        // Removing a signer below the threshold would leave no reachable
        // quorum, so the feed could never be written again. Refuse rather
        // than strand it; lower the threshold first.
        if (!allowed && threshold > next) revert BadThreshold(threshold, next);

        isSigner[signer] = allowed;
        signerCount = next;
        emit SignerSet(signer, allowed);
    }

    function setThreshold(uint8 newThreshold) external onlyOwner {
        if (newThreshold == 0 || newThreshold > signerCount) {
            revert BadThreshold(newThreshold, signerCount);
        }
        threshold = newThreshold;
        emit ThresholdSet(newThreshold);
    }

    /**
     * @notice Offer ownership. The recipient must accept it.
     * @dev Two steps, because the owner is the only address that can rotate a
     *      compromised signer or raise the threshold. A single-step transfer
     *      to a mistyped address destroys both powers permanently, and the
     *      contract's whole claim is that the threshold is a parameter rather
     *      than a redeploy. A zero check alone still lets a typo win.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipOffered(newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnerSet(msg.sender);
    }
}
