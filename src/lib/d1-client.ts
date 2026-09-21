/**
 * Cloudflare D1 Client
 * Thực thi các câu truy vấn SQL lên Cloudflare D1 database qua REST API.
 */

interface D1QueryResult<T = unknown> {
  results: T[];
  success: boolean;
  meta: {
    changed_db?: boolean;
    changes?: number;
    duration?: number;
    last_row_id?: number;
    rows_read?: number;
    rows_written?: number;
  };
}

interface D1ApiResponse<T = unknown> {
  result: D1QueryResult<T>[];
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
}

export class D1Client {
  private accountId: string;
  private databaseId: string;
  private apiToken: string;

  constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID || 'dc736286ee90e543020c3408bd23a5c8';
    this.databaseId = process.env.CLOUDFLARE_DATABASE_ID || '233ff4a2-c66a-4c61-a560-278269191ea3';
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
  }

  get isConfigured(): boolean {
    return Boolean(this.accountId && this.databaseId && this.apiToken);
  }

  /**
   * Thực thi 1 câu lệnh SQL đơn
   */
  async query<T = unknown>(sql: string, params: (string | number | null | undefined)[] = []): Promise<D1QueryResult<T>> {
    if (!this.isConfigured) {
      throw new Error('Cloudflare D1 chưa được cấu hình đầy đủ (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID, CLOUDFLARE_API_TOKEN).');
    }

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params }),
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Lỗi gọi Cloudflare D1 (${res.status}): ${text}`);
    }

    const data: D1ApiResponse<T> = await res.json();
    if (!data.success || !data.result?.[0]) {
      const errorMsg = data.errors?.map((e) => e.message).join(', ') || 'Truy vấn thất bại';
      throw new Error(`Cloudflare D1 Query Error: ${errorMsg}`);
    }

    return data.result[0];
  }

  /**
   * Thực thi nhiều câu lệnh trong 1 batch / transaction nguyên tử
   */
  async batch<T = unknown>(statements: Array<{ sql: string; params?: (string | number | null | undefined)[] }>): Promise<D1QueryResult<T>[]> {
    if (!this.isConfigured) {
      throw new Error('Cloudflare D1 chưa được cấu hình đầy đủ.');
    }

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(statements),
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Lỗi gọi Cloudflare D1 Batch (${res.status}): ${text}`);
    }

    const data: D1ApiResponse<T> = await res.json();
    if (!data.success) {
      const errorMsg = data.errors?.map((e) => e.message).join(', ') || 'Batch thất bại';
      throw new Error(`Cloudflare D1 Batch Error: ${errorMsg}`);
    }

    return data.result;
  }
}

export const d1 = new D1Client();
