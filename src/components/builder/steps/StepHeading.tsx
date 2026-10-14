export function StepHeading({ eyebrow, title, subtitle }: { eyebrow?: string; title: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {eyebrow ? <div className="text-xs font-bold tracking-[0.14em] text-primary uppercase">{eyebrow}</div> : null}
      <h1 className="font-display text-3xl leading-[1.1] font-bold sm:text-4xl">{title}</h1>
      {subtitle ? <p className="max-w-xl text-base text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}
