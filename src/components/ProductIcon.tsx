export const productIconUrl = `${import.meta.env.BASE_URL}icons/product-icon.png`;

export function ProductIcon({ className }: { className?: string }) {
  return (
    <img
      data-slot="product-icon"
      src={productIconUrl}
      alt=""
      aria-hidden="true"
      width={256}
      height={256}
      className={className}
      draggable={false}
    />
  );
}
