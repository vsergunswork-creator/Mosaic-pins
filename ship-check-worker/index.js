html: `
<div style="
  background:#0b0d11;
  padding:24px;
  font-family: Arial, sans-serif;
  color:#e9eef7;
">
  <div style="
    max-width:520px;
    margin:0 auto;
    border-radius:18px;
    border:1px solid rgba(255,255,255,.08);
    background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
    box-shadow:0 12px 30px rgba(0,0,0,.45);
    overflow:hidden;
  ">

    <div style="
      padding:18px;
      border-bottom:1px solid rgba(255,255,255,.08);
      background:linear-gradient(180deg, rgba(34,197,94,.14), rgba(0,0,0,0));
    ">
      <div style="font-weight:900; font-size:16px; letter-spacing:.2px;">
        🟢 ${escapeHtml(env.STORE_NAME || "Mosaic Pins")}
      </div>
      <div style="color:#a8b3c7; font-size:13px; margin-top:4px;">
        Shipping update
      </div>
    </div>

    <div style="padding:20px;">
      <div style="font-size:18px; font-weight:900; margin-bottom:10px;">
        Hello ${escapeHtml(name || "friend")},
      </div>

      <div style="color:#a8b3c7; font-size:14px; line-height:1.5; margin-bottom:16px;">
        Good news — your order <b style="color:#e9eef7;">${escapeHtml(orderId)}</b> has been shipped 🚚📦
      </div>

      <div style="
        border:1px solid rgba(255,255,255,.08);
        background:rgba(0,0,0,.22);
        border-radius:16px;
        padding:14px;
      ">
        <div style="font-size:13px; color:#a8b3c7; margin-bottom:6px;">
          Carrier
        </div>
        <div style="font-size:15px; font-weight:900; margin-bottom:12px;">
          ${escapeHtml(env.DEFAULT_CARRIER || "DPD / DHL")}
        </div>

        <div style="font-size:13px; color:#a8b3c7; margin-bottom:6px;">
          Tracking number
        </div>
        <div style="
          font-size:15px;
          font-weight:900;
          letter-spacing:.4px;
          word-break:break-word;
        ">
          ${escapeHtml(tracking)}
        </div>
      </div>

      <div style="color:#a8b3c7; font-size:13px; margin-top:16px;">
        If you have any questions, just reply to this email.
      </div>
    </div>

    <div style="
      padding:14px 18px;
      border-top:1px solid rgba(255,255,255,.08);
      background:rgba(0,0,0,.25);
      color:#a8b3c7;
      font-size:12px;
    ">
      Support: <b style="color:#e9eef7;">support@mosaicpins.space</b>
    </div>

  </div>
</div>
`,