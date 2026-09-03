/** Marks a command or feature that is scheduled but not shipped yet. */
export function Planned({ phase }: { phase: number }) {
  return (
    <span className="automax-planned" title={`Planned in phase ${phase} of the AutoMax roadmap`}>
      Planned in Phase {phase}
    </span>
  );
}
