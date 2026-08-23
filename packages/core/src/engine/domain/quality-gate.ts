/** A verification command and its completion requirement. */
export interface QualityGate {
  readonly name: string;
  readonly command: string;
  readonly description: string;
  readonly required: boolean;
}
