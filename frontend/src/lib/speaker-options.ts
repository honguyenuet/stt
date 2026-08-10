export const SPEAKER_COUNT_OPTIONS = [
  { value: "auto", label: "Tự nhận diện" },
  ...Array.from({ length: 10 }, (_, index) => ({
    value: String(index + 1),
    label: `${index + 1} người/giọng`,
  })),
];
