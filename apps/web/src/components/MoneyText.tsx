// Money text with its cents in their own span, so they can be set smaller
// and lighter. The text content, and so what is read or copied, is unchanged.
export default function MoneyText({ text }: { text: string }) {
  return text.split(/(\.\d{2})(?!\d)/).map((part, index) =>
    index % 2 ? (
      <span className="cents" key={index}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}
