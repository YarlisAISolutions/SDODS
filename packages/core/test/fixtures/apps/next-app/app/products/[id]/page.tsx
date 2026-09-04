export default function Product({ params }: { params: { id: string } }) {
  return <article data-testid="product">{params.id}</article>;
}
