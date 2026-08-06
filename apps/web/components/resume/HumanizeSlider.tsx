"use client";
import * as RadixSlider from "@radix-ui/react-slider";
import { useTailoringStore } from "@/stores/tailoring-store";

export function HumanizeSlider() {
  const { humanizeLevel, setHumanizeLevel } = useTailoringStore();

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex justify-between items-center">
        <span className="text-label-md text-on-surface-variant">Humanize Level</span>
        <span className="text-label-md text-primary font-bold">{humanizeLevel}</span>
      </div>
      <div className="flex items-center justify-between text-caption text-on-surface-variant mb-xs">
        <span>Natural</span>
        <span>ATS Max</span>
      </div>
      <RadixSlider.Root
        value={[humanizeLevel]}
        onValueChange={([v]) => setHumanizeLevel(v)}
        min={0}
        max={100}
        step={5}
        className="relative flex items-center w-full h-5"
      >
        <RadixSlider.Track className="bg-surface-variant relative grow rounded-full h-2">
          <RadixSlider.Range className="absolute bg-primary rounded-full h-full" />
        </RadixSlider.Track>
        <RadixSlider.Thumb className="block w-5 h-5 bg-primary rounded-full shadow-md focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer" />
      </RadixSlider.Root>
    </div>
  );
}
