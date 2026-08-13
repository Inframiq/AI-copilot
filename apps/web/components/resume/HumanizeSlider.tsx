"use client";
import * as RadixSlider from "@radix-ui/react-slider";

export function HumanizeSlider({
  value,
  onChange,
  onCommit,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  // Fires once when the user releases the drag (Radix's onValueCommit),
  // distinct from onChange which fires on every tick during the drag.
  // Optional — existing call sites that only need live value updates
  // (EditorPanel/TailoringForm) are unaffected if they omit it.
  onCommit?: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex justify-between items-center">
        <span className="text-label-md text-on-surface-variant">Humanize Level</span>
        <span className="text-label-md text-primary font-bold">{value}</span>
      </div>
      <div className="flex items-center justify-between text-caption text-on-surface-variant mb-xs">
        <span>Natural</span>
        <span>ATS Max</span>
      </div>
      <RadixSlider.Root
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={([v]) => onCommit?.(v)}
        min={0}
        max={100}
        step={5}
        disabled={disabled}
        className="relative flex items-center w-full h-5 data-[disabled]:opacity-50"
      >
        <RadixSlider.Track className="bg-surface-variant relative grow rounded-full h-2">
          <RadixSlider.Range className="absolute bg-primary rounded-full h-full" />
        </RadixSlider.Track>
        <RadixSlider.Thumb className="block w-5 h-5 bg-primary rounded-full shadow-md focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer" />
      </RadixSlider.Root>
    </div>
  );
}
