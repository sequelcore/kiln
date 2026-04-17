import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}</p>;
}

describe("smoke", () => {
  it("renders a greeting", () => {
    render(<Greeting name="Kiln" />);
    expect(screen.getByText("Hello, Kiln")).toBeInTheDocument();
  });
});
