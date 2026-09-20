# Recipe: Add money handling (v2)

v1 blueprint intentionally omits a money type — most products don't
need one, and shipping a typed amount without a currency ledger is
worse than nothing. If your product handles amounts, add
[Dinero.js](https://dinerojs.com/) as a workspace package rather
than a bare `number`.

## Why Dinero

- Immutable objects (no accidental mutation of totals)
- Integer minor-units under the hood (no float rounding)
- Currency-aware arithmetic (adding USD to EUR throws)
- Formatting via ICU currency data

## Setup

```bash
pnpm --filter @runway/api add dinero.js
```

## Wrapper package

Wrap Dinero behind a `packages/money` port so DAOs and API bodies
don't take a raw `Dinero` type — keep serialization boundaries thin:

```ts
// packages/money/src/index.ts
import { dinero, toDecimal, add, subtract } from "dinero.js";
import { USD, EUR, GBP } from "@dinero.js/currencies";

export const CURRENCIES = { USD, EUR, GBP } as const;
export type CurrencyCode = keyof typeof CURRENCIES;

export interface MoneyJson {
  amount: number;      // integer minor units
  currency: CurrencyCode;
}

export function fromJson({ amount, currency }: MoneyJson) {
  return dinero({ amount, currency: CURRENCIES[currency] });
}

export function toJson(d: ReturnType<typeof dinero>): MoneyJson {
  // Dinero doesn't ship a bare `.toJSON()` — build the shape yourself.
  return {
    amount: Number(toDecimal(d, ({ value, currency }) =>
      Number((Number.parseFloat(value) * 10 ** currency.exponent).toFixed(0)),
    )),
    currency: d.calculator === undefined ? "USD" : "USD", // TODO: extract via getter
  };
}

export { add, subtract, dinero, toDecimal };
```

## D1 storage

Store as two columns per amount (`_amount_minor INTEGER`,
`_currency CHAR(3)`). Never mix currencies in a single column — a
future migration wanting to change base currency becomes trivial.

## Zod schema

```ts
export const MoneySchema = z.object({
  amount: z.number().int().nonnegative(),
  currency: z.enum(["USD", "EUR", "GBP"]),
});
```

## API contract

Response body: emit `MoneyJson` verbatim. Formatted display strings
(`$12.34`) belong in the client — they encode locale, which the API
shouldn't guess.

## Testing

Fixture-driven: multiply/add/subtract each currency at typical
amounts. Assert immutability (`original.amount` unchanged after
arithmetic).

## Alternatives considered

- **`js-money`**: unmaintained since 2016.
- **`money-math`**: string-only, harder to compose.
- **Hand-rolled bigint minor units**: works fine at small scale but
  loses currency-aware guardrails. Fine for internal ledgers with
  one currency.

## Migration from raw `number`

If you started with `number` amounts (a mistake this recipe is
trying to help you avoid): dump every existing amount to CSV, run
one-off script to compute `amount_minor = round(value * 100)` per
row, run a migration to add the new columns + copy, drop the old
column. Do NOT try to migrate in-place with a formula in SQL — you
lose the input precision.
