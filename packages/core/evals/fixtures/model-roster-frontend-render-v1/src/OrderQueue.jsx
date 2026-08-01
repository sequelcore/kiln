import { useState } from "react";

export function OrderQueue() {
  const [open, setOpen] = useState(false);
  return (
    <main>
      <h2>Orders</h2>
      <div>
        <span>Order</span><span>Customer</span><span>Action</span>
        <span>A-104</span><span>Ada Lovelace</span>
        <div onClick={() => setOpen(true)}>Review</div>
      </div>
      {open ? (
        <div className="backdrop">
          <div className="dialog">
            <h3>Review A-104</h3>
            <button onClick={() => setOpen(false)}>OK</button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
