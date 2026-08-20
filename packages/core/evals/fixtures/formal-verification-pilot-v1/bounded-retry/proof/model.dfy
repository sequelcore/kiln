method CappedDelay(rawDelay: int, maxDelay: int) returns (delay: int)
  requires rawDelay >= 0
  requires maxDelay > 0
  ensures 0 <= delay <= maxDelay
  ensures rawDelay <= maxDelay ==> delay == rawDelay
  ensures rawDelay > maxDelay ==> delay == maxDelay
{
  delay := rawDelay;
}
