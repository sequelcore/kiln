export type DeepReadonly<T> = T extends readonly unknown[]
  ? ReadonlyArray<DeepReadonly<T[number]>>
  : T extends Readonly<Record<PropertyKey, unknown>>
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

