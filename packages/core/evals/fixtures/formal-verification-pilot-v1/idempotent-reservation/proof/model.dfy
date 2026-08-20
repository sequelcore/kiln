method Remaining(stock: int, quantity: int) returns (remaining: int)
  requires stock >= 0
  requires quantity > 0
  requires quantity <= stock
  ensures remaining >= 0
  ensures remaining < stock
{
  remaining := stock;
}
