/**
 * TapeGuard ABI, generated from the Foundry artifact.
 *
 * Generated rather than hand-written: the digest depends on the exact field
 * order of the Verdict tuple, and a hand-kept copy that drifts by one field
 * still typechecks while every signature silently fails to recover.
 *
 *   npm run abi
 */

export const TAPEGUARD_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "initialSigner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "MAX_FUTURE_SKEW_SEC",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "POST_BAD_SIGNATURE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "POST_BELOW_THRESHOLD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "POST_FUTURE_DATED",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "POST_NOT_NEWER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "POST_OK",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "POST_UNSORTED",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PRICE_SCALE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PROVENANCE_TRADED",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "acceptOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "digest",
    "inputs": [
      {
        "name": "ticker",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "v",
        "type": "tuple",
        "internalType": "struct TapeGuard.Verdict",
        "components": [
          {
            "name": "price",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "publishedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "lastTradeTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "confidenceBps",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "flags",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "provenance",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "session",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "maxDeviationBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "sourceCount",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "domainSeparator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getBandedPrice",
    "inputs": [
      {
        "name": "ticker",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "lo",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "hi",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPriceIfSafe",
    "inputs": [
      {
        "name": "ticker",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "maxAge",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "allowedFlags",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPriceIfSafe",
    "inputs": [
      {
        "name": "ticker",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "maxAge",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getVerdict",
    "inputs": [
      {
        "name": "ticker",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct TapeGuard.Verdict",
        "components": [
          {
            "name": "price",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "publishedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "lastTradeTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "confidenceBps",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "flags",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "provenance",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "session",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "maxDeviationBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "sourceCount",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isSigner",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "needsUpdate",
    "inputs": [
      {
        "name": "tickers",
        "type": "string[]",
        "internalType": "string[]"
      },
      {
        "name": "maxAge",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [
      {
        "name": "out",
        "type": "bool[]",
        "internalType": "bool[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingOwner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "postVerdict",
    "inputs": [
      {
        "name": "ticker",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "v",
        "type": "tuple",
        "internalType": "struct TapeGuard.Verdict",
        "components": [
          {
            "name": "price",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "publishedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "lastTradeTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "confidenceBps",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "flags",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "provenance",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "session",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "maxDeviationBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "sourceCount",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      },
      {
        "name": "signatures",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "postVerdicts",
    "inputs": [
      {
        "name": "tickers",
        "type": "string[]",
        "internalType": "string[]"
      },
      {
        "name": "verdicts",
        "type": "tuple[]",
        "internalType": "struct TapeGuard.Verdict[]",
        "components": [
          {
            "name": "price",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "publishedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "lastTradeTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "confidenceBps",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "flags",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "provenance",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "session",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "maxDeviationBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "sourceCount",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      },
      {
        "name": "signatures",
        "type": "bytes[][]",
        "internalType": "bytes[][]"
      }
    ],
    "outputs": [
      {
        "name": "codes",
        "type": "uint8[]",
        "internalType": "uint8[]"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setSigner",
    "inputs": [
      {
        "name": "signer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setThreshold",
    "inputs": [
      {
        "name": "newThreshold",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "signerCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "threshold",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "OwnerSet",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipOffered",
    "inputs": [
      {
        "name": "pendingOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PostRejected",
    "inputs": [
      {
        "name": "ticker",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "code",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SignerSet",
    "inputs": [
      {
        "name": "signer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ThresholdSet",
    "inputs": [
      {
        "name": "threshold",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VerdictPosted",
    "inputs": [
      {
        "name": "tickerIndexed",
        "type": "string",
        "indexed": true,
        "internalType": "string"
      },
      {
        "name": "ticker",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "price",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "confidenceBps",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "flags",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "provenance",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "session",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "publishedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "relayer",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BadThreshold",
    "inputs": [
      {
        "name": "threshold",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "signerCount",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "Flagged",
    "inputs": [
      {
        "name": "ticker",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "flags",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "disallowed",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "LengthMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotLive",
    "inputs": [
      {
        "name": "ticker",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "provenance",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotPendingOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotPosted",
    "inputs": [
      {
        "name": "ticker",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "TooOld",
    "inputs": [
      {
        "name": "ticker",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "age",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "maxAge",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  }
] as const;
