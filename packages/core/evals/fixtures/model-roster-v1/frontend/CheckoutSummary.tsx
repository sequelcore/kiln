interface Line {
  readonly id: string;
  readonly label: string;
}

export function CheckoutSummary(props: {
  readonly lines: readonly Line[];
  readonly error?: string;
  readonly clear(): void;
}) {
  return (
    <form>
      <ul>
        {props.lines.map((line, index) => <li key={index}>{line.label}</li>)}
      </ul>
      {props.error ? <p>{props.error}</p> : null}
      <button onClick={props.clear}>Clear cart</button>
    </form>
  );
}
