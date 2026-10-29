// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuggestInput } from "@/components/ui/SuggestInput";
import type { SuggestKind } from "@/lib/suggest";

function Field({ kind = "skill", list = false, onPick, onKeyDown, onSaved }: {
  kind?: SuggestKind; list?: boolean; onPick?: (n: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; onSaved?: (v: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <SuggestInput
      kind={kind}
      list={list}
      aria-label="Field"
      value={value}
      onValueChange={(v) => { setValue(v); onSaved?.(v); }}
      onPick={onPick}
      onKeyDown={onKeyDown}
    />
  );
}

const field = () => screen.getByRole("combobox", { name: "Field" });

describe("SuggestInput", () => {
  it("suggests as you type, and Enter takes the standard name for an alias", async () => {
    const saved = vi.fn();
    render(<Field onSaved={saved} />);
    await userEvent.type(field(), "js");
    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveTextContent("JavaScript");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(field()).toHaveValue("JavaScript");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("highlights nothing for new text, so Enter still means what was typed", async () => {
    const onKeyDown = vi.fn();
    render(<Field onKeyDown={onKeyDown} />);
    await userEvent.type(field(), "Reac");
    expect(await screen.findAllByRole("option")).not.toHaveLength(0);
    expect(screen.queryByRole("option", { selected: true })).toBeNull();
    await userEvent.keyboard("{Enter}");
    expect(field()).toHaveValue("Reac");
    expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: "Enter" }));
  });

  it("moves through suggestions with the arrows and takes one with a click", async () => {
    render(<Field />);
    await userEvent.type(field(), "pyth");
    await screen.findAllByRole("option");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(field()).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0].id);
    await userEvent.click(screen.getByRole("option", { name: "Python" }));
    expect(field()).toHaveValue("Python");
    expect(field()).toHaveFocus();
  });

  it("gives a pick to onPick instead of keeping it, for a field that adds chips", async () => {
    const onPick = vi.fn();
    render(<Field onPick={onPick} />);
    await userEvent.type(field(), "k8s");
    await screen.findAllByRole("option");
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith("Kubernetes");
  });

  it("suggests for the part after the last comma in a list", async () => {
    render(<Field list />);
    await userEvent.type(field(), "React, nod");
    await userEvent.click(await screen.findByRole("option", { name: "Node.js" }));
    expect(field()).toHaveValue("React, Node.js");
  });

  it("on leaving, puts an exact name or alias in the list's spelling and keeps anything else", async () => {
    render(
      <>
        <Field list />
        <button>elsewhere</button>
      </>,
    );
    await userEvent.type(field(), "javascript, my own tool, postgres");
    await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(field()).toHaveValue("JavaScript, my own tool, PostgreSQL");
  });

  it("closes on Escape without the key reaching anything around it", async () => {
    const outer = vi.fn();
    render(<div onKeyDown={outer}><Field /></div>);
    await userEvent.type(field(), "py");
    await screen.findAllByRole("option");
    outer.mockClear();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(outer).not.toHaveBeenCalled();
  });

  it("credits GeoNames under city suggestions", async () => {
    render(<Field kind="city" />);
    await userEvent.type(field(), "visakh");
    expect(await screen.findByText("Place names: GeoNames (CC BY 4.0)")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Visakhapatnam, India" })).toBeInTheDocument();
  });
});
