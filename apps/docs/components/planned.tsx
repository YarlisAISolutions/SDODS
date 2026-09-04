/** Marks a command or feature that is scheduled but not shipped yet. */
export function Planned({ phase }: { phase: number }) {
  return (
    <span className="sdods-planned" title={`Planned in phase ${phase} of the SDODS roadmap`}>
      Planned in Phase {phase}
    </span>
  );
}
