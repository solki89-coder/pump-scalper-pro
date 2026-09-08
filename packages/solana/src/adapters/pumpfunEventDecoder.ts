/**
 * Decoded fields from pump.fun's on-chain `Create` instruction / `CreateEvent`
 * that are NOT generically derivable from transaction structure (unlike
 * mint/creator — see pumpfun.ts): token name, symbol, metadata URI, and the
 * bonding-curve account address.
 *
 * NOT IMPLEMENTED. Decoding these requires pump.fun's Anchor IDL to
 * borsh-decode the instruction args / event log. Pump.fun does not publish
 * an official IDL; community-maintained ones exist (e.g. bundled in
 * chainstacklabs/pumpfun-bonkfun-bot's `idl/` folder) but this project does
 * not vendor one without being able to verify it against the currently
 * deployed program — silently decoding with a wrong/stale layout would
 * produce plausible-looking garbage presented as real data, which is worse
 * than admitting the gap.
 *
 * To enable this: supply a verified IDL, decode with
 * `@coral-xyz/anchor`'s `BorshCoder`/`BorshEventCoder`, and implement this
 * interface. Until then, `TokenScanner` (apps/api/src/scanner) fills
 * name/symbol from the DexScreener enrichment pass instead, and leaves them
 * as an explicit "PENDING_METADATA" placeholder in between.
 */
export interface PumpFunEventDecoder {
  decodeCreateInstruction(instructionData: Buffer): {
    name: string;
    symbol: string;
    uri: string;
    bondingCurve: string;
  } | null;
}

export class NotConfiguredPumpFunEventDecoder implements PumpFunEventDecoder {
  decodeCreateInstruction(): null {
    return null;
  }
}
