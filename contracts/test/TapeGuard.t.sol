// SPDX-License-Identifier: ISC
pragma solidity 0.8.29;

import {TapeGuard} from "../TapeGuard.sol";

/// @dev Minimal cheatcode surface. Declared here so the repository keeps its
///      zero-dependency property rather than vendoring a library for six
///      function signatures.
interface Vm {
    function sign(uint256 pk, bytes32 d) external pure returns (uint8, bytes32, bytes32);
    function addr(uint256 pk) external pure returns (address);
    function warp(uint256) external;
    function prank(address) external;
}

contract TapeGuardTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    uint256 constant PK_A = 0xA11CE;
    uint256 constant PK_B = 0xB0B;
    uint256 constant PK_C = 0xC0FFEE;
    uint256 constant PK_EVIL = 0xDEAD;

    uint16 constant FLAG_SPLIT_PENDING = 1 << 0;
    uint16 constant FLAG_EARNINGS_WINDOW = 1 << 1;
    uint16 constant FLAG_SINGLE_SOURCE = 1 << 4;

    uint8 constant TRADED = 0;
    uint8 constant DERIVED = 1;
    uint8 constant HALTED = 3;

    TapeGuard guard;

    function setUp() public {
        guard = new TapeGuard(vm.addr(PK_A));
        vm.warp(1_790_000_000);
    }

    // ------------------------------------------------------------- helpers

    function _verdict(uint16 flags, uint8 provenance) internal view returns (TapeGuard.Verdict memory) {
        return TapeGuard.Verdict({
            price: 180 * 1e8,
            publishedAt: uint64(block.timestamp),
            lastTradeTime: uint64(block.timestamp) - 3,
            confidenceBps: 9,
            flags: flags,
            provenance: provenance,
            session: 0,
            maxDeviationBps: 1,
            sourceCount: 2
        });
    }

    function _sign(uint256 pk, string memory ticker, TapeGuard.Verdict memory v)
        internal
        view
        returns (bytes memory)
    {
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(pk, guard.digest(ticker, v));
        return abi.encodePacked(r, s, sv);
    }

    function _one(uint256 pk, string memory ticker, TapeGuard.Verdict memory v)
        internal
        view
        returns (bytes[] memory out)
    {
        out = new bytes[](1);
        out[0] = _sign(pk, ticker, v);
    }

    /// @dev Signatures must arrive sorted by recovered address, so sort here.
    function _two(uint256 p1, uint256 p2, string memory ticker, TapeGuard.Verdict memory v)
        internal
        view
        returns (bytes[] memory out)
    {
        (uint256 lo, uint256 hi) = vm.addr(p1) < vm.addr(p2) ? (p1, p2) : (p2, p1);
        out = new bytes[](2);
        out[0] = _sign(lo, ticker, v);
        out[1] = _sign(hi, ticker, v);
    }

    function _call(bytes memory payload) internal returns (bool ok, bytes memory data) {
        (ok, data) = address(guard).call(payload);
    }

    function _assert(bool cond, string memory what) internal pure {
        if (!cond) revert(what);
    }

    function _assertReverts(bytes memory payload, bytes4 selector, string memory what) internal {
        (bool ok, bytes memory data) = _call(payload);
        _assert(!ok, what);
        if (selector != bytes4(0)) _assert(bytes4(data) == selector, string.concat(what, ": wrong error"));
    }

    // ------------------------------------------------------------- posting

    function test_PostsWithAValidSignature() public {
        TapeGuard.Verdict memory v = _verdict(0, TRADED);
        guard.postVerdict("NVDA", v, _one(PK_A, "NVDA", v));
        _assert(guard.getVerdict("NVDA").price == 180 * 1e8, "price not stored");
        _assert(guard.getPriceIfSafe("NVDA", 600) == 180 * 1e8, "safe read failed");
    }

    function test_AnyoneMayRelay() public {
        // The contract authenticates the signature, not the sender.
        TapeGuard.Verdict memory v = _verdict(0, TRADED);
        bytes[] memory sigs = _one(PK_A, "NVDA", v);
        vm.prank(address(0xBEEF));
        guard.postVerdict("NVDA", v, sigs);
        _assert(guard.getVerdict("NVDA").price == 180 * 1e8, "relayed post rejected");
    }

    function test_RejectsASignatureFromAStranger() public {
        TapeGuard.Verdict memory v = _verdict(0, TRADED);
        _assertReverts(
            abi.encodeCall(TapeGuard.postVerdict, ("NVDA", v, _one(PK_EVIL, "NVDA", v))),
            bytes4(0),
            "a stranger's signature was accepted"
        );
    }

    function test_RejectsAReplayAndAnythingNotNewer() public {
        TapeGuard.Verdict memory v = _verdict(0, TRADED);
        guard.postVerdict("NVDA", v, _one(PK_A, "NVDA", v));
        // Identical publishedAt: not strictly newer.
        _assertReverts(
            abi.encodeCall(TapeGuard.postVerdict, ("NVDA", v, _one(PK_A, "NVDA", v))),
            bytes4(0),
            "replay accepted"
        );
        // Older still.
        TapeGuard.Verdict memory older = _verdict(0, TRADED);
        older.publishedAt = v.publishedAt - 60;
        _assertReverts(
            abi.encodeCall(TapeGuard.postVerdict, ("NVDA", older, _one(PK_A, "NVDA", older))),
            bytes4(0),
            "older verdict accepted"
        );
    }

    function test_AFutureDatedVerdictCannotFreezeATicker() public {
        // Without this guard, one signed verdict dated far ahead is a
        // permanent freeze: nothing is ever "strictly newer", so the ticker
        // sticks at that price until the wall clock catches up. Anyone may
        // relay, so replaying one such quote is enough to reach it.
        TapeGuard.Verdict memory far = _verdict(0, TRADED);
        far.publishedAt = uint64(block.timestamp) + 3600;
        _assertReverts(
            abi.encodeCall(TapeGuard.postVerdict, ("NVDA", far, _one(PK_A, "NVDA", far))),
            bytes4(0),
            "a future-dated verdict was accepted"
        );

        // Ordinary clock skew between the signer's host and the sequencer is
        // still accepted, and the read must not panic on it.
        TapeGuard.Verdict memory skewed = _verdict(0, TRADED);
        skewed.publishedAt = uint64(block.timestamp) + 30;
        guard.postVerdict("NVDA", skewed, _one(PK_A, "NVDA", skewed));
        _assert(guard.getPriceIfSafe("NVDA", 600) == 180 * 1e8, "clock skew broke the read");

        string[] memory tickers = new string[](1);
        tickers[0] = "NVDA";
        _assert(!guard.needsUpdate(tickers, 600)[0], "skew made a fresh verdict look stale");
    }

    function test_RejectsAMalleableSignature() public {
        TapeGuard.Verdict memory v = _verdict(0, TRADED);
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(PK_A, guard.digest("NVDA", v));
        // The other valid encoding of the same authorisation: (r, n-s, v^1).
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 flipped = bytes32(n - uint256(s));
        uint8 flippedV = sv == 27 ? 28 : 27;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = abi.encodePacked(r, flipped, flippedV);
        _assertReverts(
            abi.encodeCall(TapeGuard.postVerdict, ("NVDA", v, sigs)),
            bytes4(0),
            "malleable signature accepted"
        );
    }

    function test_ASignatureIsScopedToThisContract() public {
        // A verdict signed for one deployment must not post to another. A bare
        // digest over the tuple would let a testnet signature reach mainnet.
        TapeGuard other = new TapeGuard(vm.addr(PK_A));
        TapeGuard.Verdict memory v = _verdict(0, TRADED);
        bytes[] memory forThisOne = _one(PK_A, "NVDA", v);

        _assert(guard.domainSeparator() != other.domainSeparator(), "domains collide");

        (bool ok,) = address(other).call(
            abi.encodeCall(TapeGuard.postVerdict, ("NVDA", v, forThisOne))
        );
        _assert(!ok, "cross-contract replay accepted");
    }

    // ------------------------------------------------------------- reading

    function test_TheRevertNamesTheFlagsThatStoppedIt() public {
        TapeGuard.Verdict memory v = _verdict(FLAG_SPLIT_PENDING | FLAG_EARNINGS_WINDOW, TRADED);
        guard.postVerdict("NVDA", v, _one(PK_A, "NVDA", v));

        (bool ok, bytes memory data) =
            _call(abi.encodeWithSignature("getPriceIfSafe(string,uint64)", "NVDA", uint64(600)));
        _assert(!ok, "flagged price was served");
        _assert(bytes4(data) == TapeGuard.Flagged.selector, "wrong error");

        (, uint16 flags, uint16 disallowed) =
            abi.decode(_strip(data), (string, uint16, uint16));
        _assert(flags == (FLAG_SPLIT_PENDING | FLAG_EARNINGS_WINDOW), "flags not returned");
        _assert(disallowed == flags, "caller cannot see which flags to fix");
    }

    function test_ACallerMayOptIntoARiskItUnderstands() public {
        TapeGuard.Verdict memory v = _verdict(FLAG_EARNINGS_WINDOW | FLAG_SINGLE_SOURCE, TRADED);
        guard.postVerdict("NVDA", v, _one(PK_A, "NVDA", v));

        // Opting into one of two flags is not enough; the other still stops it.
        (bool partialOk,) = _call(
            abi.encodeWithSignature(
                "getPriceIfSafe(string,uint64,uint16)", "NVDA", uint64(600), FLAG_EARNINGS_WINDOW
            )
        );
        _assert(!partialOk, "an unacknowledged flag was ignored");

        (bool full, bytes memory data) = _call(
            abi.encodeWithSignature(
                "getPriceIfSafe(string,uint64,uint16)",
                "NVDA",
                uint64(600),
                FLAG_EARNINGS_WINDOW | FLAG_SINGLE_SOURCE
            )
        );
        _assert(full, "explicit opt-in was refused");
        _assert(abi.decode(data, (uint128)) == 180 * 1e8, "wrong price");
    }

    function test_RefusesAnythingThatIsNotALivePrint() public {
        for (uint8 p = 1; p <= 3; p++) {
            vm.warp(block.timestamp + 1); // advance the clock, do not forward-date
            TapeGuard.Verdict memory v = _verdict(0, p);
            guard.postVerdict("NVDA", v, _one(PK_A, "NVDA", v));
            _assertReverts(
                abi.encodeWithSignature("getPriceIfSafe(string,uint64)", "NVDA", uint64(600)),
                TapeGuard.NotLive.selector,
                "a non-live price was served"
            );
        }
    }

    function test_RefusesAStaleVerdict() public {
        TapeGuard.Verdict memory v = _verdict(0, TRADED);
        guard.postVerdict("NVDA", v, _one(PK_A, "NVDA", v));
        vm.warp(block.timestamp + 601);
        _assertReverts(
            abi.encodeWithSignature("getPriceIfSafe(string,uint64)", "NVDA", uint64(600)),
            TapeGuard.TooOld.selector,
            "an expired verdict was served"
        );
    }

    function test_AnUnknownTickerRevertsRatherThanReturningZero() public {
        _assertReverts(
            abi.encodeWithSignature("getPriceIfSafe(string,uint64)", "MSFT", uint64(600)),
            TapeGuard.NotPosted.selector,
            "an unposted ticker did not revert"
        );
    }

    function test_BandEdgesAreIntegerArithmetic() public {
        TapeGuard.Verdict memory v = _verdict(0, TRADED);
        v.confidenceBps = 50; // 0.50%
        guard.postVerdict("NVDA", v, _one(PK_A, "NVDA", v));
        (uint128 lo, uint128 hi) = guard.getBandedPrice("NVDA");
        // 180e8 * 50 / 10000 = 0.9e8 exactly. In floating point this edge
        // lands at 180.89999999999998 and a print on it scores as a miss.
        _assert(lo == uint128(180 * 1e8 - 0.9e8), "low edge wrong");
        _assert(hi == uint128(180 * 1e8 + 0.9e8), "high edge wrong");
    }

    function test_ANoClaimBandFloorsAtZeroRatherThanUnderflowing() public {
        TapeGuard.Verdict memory v = _verdict(FLAG_SPLIT_PENDING, DERIVED);
        v.confidenceBps = 10_000; // the no-claim band: 100%
        guard.postVerdict("NVDA", v, _one(PK_A, "NVDA", v));
        (uint128 lo, uint128 hi) = guard.getBandedPrice("NVDA");
        _assert(lo == 0, "low edge underflowed");
        _assert(hi == uint128(360 * 1e8), "high edge wrong");
    }

    // ------------------------------------------------------------ threshold

    function test_ThresholdTwoOfThree() public {
        guard.setSigner(vm.addr(PK_B), true);
        guard.setSigner(vm.addr(PK_C), true);
        guard.setThreshold(2);

        TapeGuard.Verdict memory v = _verdict(0, TRADED);

        // One signature no longer suffices, although it is a valid signer.
        _assertReverts(
            abi.encodeCall(TapeGuard.postVerdict, ("NVDA", v, _one(PK_A, "NVDA", v))),
            bytes4(0),
            "one of two was accepted"
        );

        guard.postVerdict("NVDA", v, _two(PK_A, PK_B, "NVDA", v));
        _assert(guard.getPriceIfSafe("NVDA", 600) == 180 * 1e8, "quorum post failed");
    }

    function test_RejectsUnsortedAndDuplicateSigners() public {
        guard.setSigner(vm.addr(PK_B), true);
        guard.setThreshold(2);
        TapeGuard.Verdict memory v = _verdict(0, TRADED);

        // Reversed order.
        bytes[] memory sorted = _two(PK_A, PK_B, "NVDA", v);
        bytes[] memory reversed = new bytes[](2);
        reversed[0] = sorted[1];
        reversed[1] = sorted[0];
        _assertReverts(
            abi.encodeCall(TapeGuard.postVerdict, ("NVDA", v, reversed)),
            bytes4(0),
            "unsorted signatures accepted"
        );

        // The same signer twice must not satisfy a 2-of-N quorum.
        bytes[] memory doubled = new bytes[](2);
        doubled[0] = _sign(PK_A, "NVDA", v);
        doubled[1] = _sign(PK_A, "NVDA", v);
        _assertReverts(
            abi.encodeCall(TapeGuard.postVerdict, ("NVDA", v, doubled)),
            bytes4(0),
            "one signer counted twice"
        );
    }

    function test_CannotStrandTheQuorum() public {
        guard.setSigner(vm.addr(PK_B), true);
        guard.setThreshold(2);
        // Removing a signer here would leave threshold 2 over 1 signer, so no
        // quorum could ever be reached and the feed would be unwritable.
        _assertReverts(
            abi.encodeCall(TapeGuard.setSigner, (vm.addr(PK_B), false)),
            TapeGuard.BadThreshold.selector,
            "the feed was left unwritable"
        );
    }

    function test_RejectsAZeroAddressSigner() public {
        _assertReverts(
            abi.encodeCall(TapeGuard.setSigner, (address(0), true)),
            TapeGuard.ZeroAddress.selector,
            "zero address allow-listed"
        );
    }

    // ---------------------------------------------------------------- batch

    function test_ABatchRecordsOneFailureWithoutDiscardingTheRest() public {
        TapeGuard.Verdict memory good = _verdict(0, TRADED);

        string[] memory tickers = new string[](3);
        tickers[0] = "NVDA";
        tickers[1] = "AAPL";
        tickers[2] = "SPY";

        TapeGuard.Verdict[] memory vs = new TapeGuard.Verdict[](3);
        vs[0] = good;
        vs[1] = good;
        vs[2] = good;

        bytes[][] memory sigs = new bytes[][](3);
        sigs[0] = _one(PK_A, "NVDA", good);
        sigs[1] = _one(PK_EVIL, "AAPL", good); // forged
        sigs[2] = _one(PK_A, "SPY", good);

        uint8[] memory codes = guard.postVerdicts(tickers, vs, sigs);
        _assert(codes[0] == guard.POST_OK(), "first item lost");
        _assert(codes[1] == guard.POST_BAD_SIGNATURE(), "forgery not reported");
        _assert(codes[2] == guard.POST_OK(), "a forged sibling discarded a good item");

        _assert(guard.getVerdict("NVDA").price == 180 * 1e8, "NVDA not stored");
        _assert(guard.getVerdict("SPY").price == 180 * 1e8, "SPY not stored");
        (bool ok,) = _call(abi.encodeWithSignature("getVerdict(string)", "AAPL"));
        _assert(!ok, "the forged item was stored");
    }

    function test_NeedsUpdateTreatsAnUnknownTickerAsNeeded() public {
        TapeGuard.Verdict memory v = _verdict(0, TRADED);
        guard.postVerdict("NVDA", v, _one(PK_A, "NVDA", v));

        string[] memory tickers = new string[](2);
        tickers[0] = "NVDA";
        tickers[1] = "NEVER_POSTED";
        bool[] memory out = guard.needsUpdate(tickers, 600);
        // One unknown symbol must not blind a keeper to the others.
        _assert(!out[0], "a fresh ticker was reported stale");
        _assert(out[1], "an unposted ticker was reported fresh");
    }

    // ---------------------------------------------------------------- admin

    function test_OwnershipTransferTakesTwoSteps() public {
        address next = address(0xC0DE);
        guard.transferOwnership(next);
        _assert(guard.owner() == address(this), "ownership moved on the offer");
        _assert(guard.pendingOwner() == next, "offer not recorded");

        // Only the named recipient can complete it.
        _assertReverts(
            abi.encodeCall(TapeGuard.acceptOwnership, ()),
            TapeGuard.NotPendingOwner.selector,
            "a stranger accepted ownership"
        );

        vm.prank(next);
        guard.acceptOwnership();
        _assert(guard.owner() == next, "ownership did not transfer");
        _assert(guard.pendingOwner() == address(0), "offer not cleared");
    }

    function test_OwnershipCannotBeSentToZero() public {
        _assertReverts(
            abi.encodeCall(TapeGuard.transferOwnership, (address(0))),
            TapeGuard.ZeroAddress.selector,
            "admin powers were burned"
        );
    }

    /// @dev Strip the 4-byte selector so the error's arguments can be decoded.
    function _strip(bytes memory data) internal pure returns (bytes memory out) {
        out = new bytes(data.length - 4);
        for (uint256 i = 0; i < out.length; i++) out[i] = data[i + 4];
    }
}
