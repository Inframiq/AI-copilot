// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// jsdom can't simulate a real pointer drag on a Radix slider (no layout,
// no pointer capture), so a genuine "drag through several intermediate
// values without committing" interaction isn't reproducible here — even
// keyboard arrow-key interaction commits on every keypress in Radix (each
// key press is a discrete, complete action, not an intermediate drag
// tick). Instead, this test proves the wiring directly: HumanizeSlider
// must forward `onChange` to Radix's `onValueChange` (fires every tick)
// and `onCommit` to Radix's `onValueCommit` (fires once, on release) as
// two SEPARATE callbacks — which is exactly the fix for the regeneration
// storm (Issue 1: dragging the thumb used to fire `onChange` straight
// into `handleRegenerate` on every tick).
let capturedProps: any = null;
vi.mock("@radix-ui/react-slider", () => ({
  Root: (props: any) => {
    capturedProps = props;
    return <div data-testid="radix-root">{props.children}</div>;
  },
  Track: ({ children }: any) => <div>{children}</div>,
  Range: () => <div />,
  Thumb: () => <div role="slider" />,
}));

import { HumanizeSlider } from "../components/resume/HumanizeSlider";

describe("HumanizeSlider onChange/onCommit wiring", () => {
  it("forwards onChange to Radix onValueChange and onCommit to Radix onValueCommit as distinct callbacks", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<HumanizeSlider value={50} onChange={onChange} onCommit={onCommit} />);

    expect(capturedProps.onValueChange).toBeTypeOf("function");
    expect(capturedProps.onValueCommit).toBeTypeOf("function");

    // Simulate three intermediate drag ticks — onChange fires each time,
    // onCommit must NOT fire from these.
    capturedProps.onValueChange([55]);
    capturedProps.onValueChange([60]);
    capturedProps.onValueChange([65]);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onCommit).not.toHaveBeenCalled();

    // Releasing the drag fires onValueCommit exactly once.
    capturedProps.onValueCommit([65]);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(65);
  });

  it("onCommit is optional — omitting it (as EditorPanel/TailoringForm do) doesn't throw when Radix commits", () => {
    const onChange = vi.fn();
    render(<HumanizeSlider value={50} onChange={onChange} />);

    expect(() => capturedProps.onValueCommit([70])).not.toThrow();
  });

  it("passes disabled through to Radix so the slider can be locked during regeneration", () => {
    render(<HumanizeSlider value={50} onChange={vi.fn()} disabled />);
    expect(capturedProps.disabled).toBe(true);
  });
});
