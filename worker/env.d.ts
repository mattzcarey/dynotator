declare namespace Cloudflare {
  interface Env {
    /** Optional secret: when set, `POST /api/sessions` requires `Authorization: Bearer <token>`. */
    DYNOTATOR_TOKEN?: string;
  }
}
