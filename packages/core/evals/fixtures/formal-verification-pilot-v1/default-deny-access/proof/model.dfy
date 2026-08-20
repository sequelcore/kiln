method CanAccess(explicitGrant: bool, isOwner: bool, action: int) returns (allowed: bool)
  ensures allowed ==>
    explicitGrant || (isOwner && (action == 0 || action == 1))
{
  allowed := true;
}
