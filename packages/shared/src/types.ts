export type OrderType = 'sale' | 'cashout';
export type OrderStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'REFUNDED';

/** Timestamps are ISO 8601 strings. Amounts in USDC base units (6 decimals) are decimal strings. */
export interface Order {
  id: string;
  type: OrderType;
  zarCents: number;
  usdcAmount: string;
  status: OrderStatus;
  payer?: string;
  txHash?: string;
  refundTxHash?: string;
  createdAt: string;
  expiresAt: string;
}

export interface TopUp {
  id: string;
  zarCents: number;
  feeZarCents: number;
  usdcAmount: string;
  customerAddress: string;
  txHash: string;
  createdAt: string;
}

/** A registered customer: unique lowercase username for one wallet address. */
export interface User {
  username: string;
  address: string;
  createdAt: string;
}
