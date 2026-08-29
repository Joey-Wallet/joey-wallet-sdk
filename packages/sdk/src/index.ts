/**
 * `@joeywallet/wallet-sdk` — the core API.
 *
 * Zero runtime dependencies, ESM only, safe to import in Node (every function
 * that needs a page checks for one first).
 */
export {
  getJoey,
  isJoeyAvailable,
  requireJoey,
  resetJoeyDetection,
  waitForJoey,
  type WaitForJoeyOptions,
} from './detect.js'

export {
  createJoeyClient,
  readAccounts,
  readChain,
  readNetwork,
  type Joey,
} from './client.js'

export {
  JOEY_ERROR_CODES,
  JoeyRpcError,
  isUserRejection,
  notInstalledError,
  userRejectedError,
  type JoeyErrorCode,
} from './errors.js'

export {
  APPROVAL_TIMEOUT_MS,
  CAIP294_ANNOUNCE_EVENT,
  CAIP294_PROMPT_EVENT,
  JOEY_DAPP_FORBIDDEN_TRANSACTION_TYPES,
  JOEY_RDNS,
  JOEY_RPC_METHODS,
  JOEY_WALLET_NAME,
  MAX_BULK_TRANSACTIONS,
  REQUEST_TIMEOUT_MS,
  WALLET_STANDARD_APP_READY_EVENT,
  WALLET_STANDARD_REGISTER_EVENT,
  invoke,
  isJoeyInjectedProvider,
  subscribe,
  type JoeyInjectedProvider,
  type JoeyProviderEventName,
  type JoeyRequestArguments,
  type JoeyRpcMethod,
} from './provider.js'

export {
  JOEY_CHAINS,
  chainForNetworkId,
  isJoeyChain,
  networkIdForChain,
  type Amount,
  type AnyTransaction,
  type ConnectParams,
  type ConnectResult,
  type IssuedCurrencyAmount,
  type JoeyAccount,
  type JoeyChain,
  type JoeyEventListener,
  type JoeyEventMap,
  type JoeyEventName,
  type JoeyNetwork,
  type Memo,
  type MPTAmount,
  type Path,
  type PathStep,
  type SignAndSubmitTransactionResult,
  type SigningContextParams,
  type SignInMode,
  type SignInParams,
  type SignInResult,
  type SignTransactionBulkParams,
  type SignTransactionForParams,
  type SignTransactionParams,
  type SignTransactionResult,
  type Signer,
  type TransactionLike,
} from './types.js'

export {
  initialMutationState,
  mutationReducer,
  toPublicState,
  type MutationAction,
  type MutationState,
  type MutationStatus,
} from './mutation.js'
