export default function TimePicker({
  hour,
  minute,
  onChange,
}: {
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
}) {
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => {
        const [h, m] = e.target.value.split(":").map(Number);
        if (Number.isFinite(h) && Number.isFinite(m)) onChange(h, m);
      }}
    />
  );
}
