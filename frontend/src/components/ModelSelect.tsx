export function ModelSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string | null | undefined
  options: string[]
  onChange: (v: string) => void
}) {
  const cur = value ?? ''
  const hasCur = cur !== '' && !options.includes(cur)
  return (
    <div>
      <div className="label">{label}</div>
      <select
        className="input"
        value={cur}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">默认（内置明文值）</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {hasCur && <option value={cur}>{cur}</option>}
      </select>
    </div>
  )
}
