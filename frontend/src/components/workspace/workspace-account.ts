export function getAccountBadge(firstName: string, lastName: string) {
  const shortFirstName = firstName.trim();
  if (shortFirstName && [...shortFirstName].length <= 3) {
    return shortFirstName.toLocaleUpperCase("vi-VN");
  }

  return `${firstName.trim()[0] ?? ""}${lastName.trim()[0] ?? ""}`
    .toLocaleUpperCase("vi-VN")
    .slice(0, 2);
}
