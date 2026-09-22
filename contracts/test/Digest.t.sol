// SPDX-License-Identifier: ISC
pragma solidity 0.8.29;

import {TapeGuard} from "../TapeGuard.sol";

interface Vm {
    function addr(uint256 pk) external pure returns (address);
    function sign(uint256 pk, bytes32 d) external pure returns (uint8, bytes32, bytes32);
    function writeFile(string calldata path, string calldata data) external;
    function toString(bytes32 value) external pure returns (string memory);
    function toString(bytes memory value) external pure returns (string memory);
    function toString(address value) external pure returns (string memory);
    function toString(uint256 value) external pure returns (string memory);
    function warp(uint256) external;
}

/**
 * Writes the digest fixture that `test/digest.test.ts` checks the TypeScript
 * signer against.
 *
 * The two implementations must agree byte for byte. A disagreement of one
 * field's order or width changes the struct hash, `ecrecover` returns some
 * other address, and the contract rejects every post as coming from a
 * stranger — a failure whose symptom points at the key rather than at the
 * encoding. Pinning both sides to one artifact is what makes that
 * impossible to ship.
 */
contract DigestFixtureTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    uint256 constant PK = 0xA11CE;

    function test_WriteDigestFixture() public {
        // The fixture carries a real timestamp so it reads as a plausible
        // verdict. Forge starts the clock at 1, so without this the contract's
        // own future-dating guard rejects it -- correctly.
        vm.warp(1790065300);
        TapeGuard guard = new TapeGuard(vm.addr(PK));

        TapeGuard.Verdict memory v = TapeGuard.Verdict({
            price: 22738000000,       // 227.38 at 1e8
            publishedAt: 1790065269,
            lastTradeTime: 1790020800,
            confidenceBps: 280,
            flags: 5,                 // SPLIT_PENDING | DISCONTINUITY
            provenance: 1,            // DERIVED
            session: 1,               // PRE
            maxDeviationBps: 11,
            sourceCount: 2
        });

        bytes32 d = guard.digest("NVDA", v);
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(PK, d);
        bytes memory sig = abi.encodePacked(r, s, sv);

        // Split across helpers: one flat concat over this many values puts
        // more than sixteen slots live at once and solc cannot reach them.
        string memory json = string.concat(
            _head(guard, d, sig),
            _verdictJson(v)
        );

        vm.writeFile("./test/fixtures/digest.json", json);

        // The fixture is only worth pinning if the contract itself accepts it.
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = sig;
        guard.postVerdict("NVDA", v, sigs);
        require(guard.getVerdict("NVDA").price == v.price, "fixture did not post");
    }

    function _head(TapeGuard guard, bytes32 d, bytes memory sig)
        private
        view
        returns (string memory)
    {
        return string.concat(
            '{\n  "chainId": ', vm.toString(block.chainid),
            ',\n  "verifyingContract": "', vm.toString(address(guard)),
            '",\n  "signer": "', vm.toString(vm.addr(PK)),
            '",\n  "ticker": "NVDA",\n  "domainSeparator": "', vm.toString(guard.domainSeparator()),
            '",\n  "digest": "', vm.toString(d),
            '",\n  "signature": "', vm.toString(sig),
            '",\n  "verdict": {'
        );
    }

    function _verdictJson(TapeGuard.Verdict memory v) private pure returns (string memory) {
        string memory a = string.concat(
            '\n    "price": "', vm.toString(uint256(v.price)),
            '",\n    "publishedAt": "', vm.toString(uint256(v.publishedAt)),
            '",\n    "lastTradeTime": "', vm.toString(uint256(v.lastTradeTime)),
            '",\n    "confidenceBps": ', vm.toString(uint256(v.confidenceBps))
        );
        string memory b = string.concat(
            ',\n    "flags": ', vm.toString(uint256(v.flags)),
            ',\n    "provenance": ', vm.toString(uint256(v.provenance)),
            ',\n    "session": ', vm.toString(uint256(v.session)),
            ',\n    "maxDeviationBps": ', vm.toString(uint256(v.maxDeviationBps)),
            ',\n    "sourceCount": ', vm.toString(uint256(v.sourceCount)),
            '\n  }\n}\n'
        );
        return string.concat(a, b);
    }
}
