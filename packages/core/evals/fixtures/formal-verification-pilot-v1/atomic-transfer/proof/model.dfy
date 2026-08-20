method Transfer(fromBalance: int, toBalance: int, amount: int)
    returns (newFrom: int, newTo: int)
  requires fromBalance >= 0
  requires toBalance >= 0
  requires amount > 0
  requires amount <= fromBalance
  ensures newFrom >= 0
  ensures newFrom == fromBalance - amount
  ensures newFrom + newTo == fromBalance + toBalance
{
  newFrom := fromBalance;
  newTo := toBalance + amount;
}
