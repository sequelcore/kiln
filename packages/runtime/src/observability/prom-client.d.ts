// Type declaration for prom-client (optional peer dependency, dynamically imported)
declare module "prom-client" {
  interface CounterConfig {
    name: string;
    help: string;
    labelNames: string[];
    registers: Registry[];
  }

  interface HistogramConfig {
    name: string;
    help: string;
    labelNames: string[];
    buckets: number[];
    registers: Registry[];
  }

  export class Registry {
    metrics(): Promise<string>;
    contentType: string;
  }

  export class Counter {
    constructor(config: CounterConfig);
    inc(labels: Record<string, string>, value?: number): void;
  }

  export class Histogram {
    constructor(config: HistogramConfig);
    observe(labels: Record<string, string>, value: number): void;
  }
}
