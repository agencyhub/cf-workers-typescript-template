export function logJson(
  level: "info" | "error" | "warn",
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify(fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
