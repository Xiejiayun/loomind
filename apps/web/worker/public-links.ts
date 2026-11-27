import { collectAllTopics, type MindmapDocument } from "@mindmap/core/model";
import { errors, jwtVerify, SignJWT } from "jose";
import { MAP_ID } from "../src/drafts/shared.js";
import { HttpError, json, requireOrigin, signingKey } from "./http.js";
import { database } from "./permissions.js";
import { knownRevision, snapshotResponse } from "./snapshot-response.js";

const audience = "loomind:public-view:v1";
const unavailable = () => new HttpError(404, "分享链接未启用或已撤销。");

export async function managePublicLink(request: Request, env: Env, subject: string | undefined, id: string) {
  if (!subject) throw new HttpError(401, "请先登录后管理分享。");
  if (!MAP_ID.test(id)) throw new HttpError(400, "导图 ID 无效。");
  if (!["GET", "PUT", "DELETE"].includes(request.method)) return json({ error: "请求方法不支持。" }, 405, [], { Allow: "GET, PUT, DELETE" });
  if (request.method !== "GET") requireOrigin(request, env);
  const db = database(env);
  const operation = request.method === "GET"
    ? db.prepare("SELECT public_view_grant AS grantId FROM mindmaps WHERE id = ? AND owner = ?").bind(id, subject)
    : request.method === "PUT"
      ? db.prepare("UPDATE mindmaps SET public_view_grant = COALESCE(public_view_grant, ?) WHERE id = ? AND owner = ? RETURNING public_view_grant AS grantId").bind(crypto.randomUUID(), id, subject)
      : db.prepare("UPDATE mindmaps SET public_view_grant = NULL WHERE id = ? AND owner = ? RETURNING public_view_grant AS grantId").bind(id, subject);
  const row = await operation.first<{ grantId: string | null }>();
  if (!row) throw new HttpError(404, "导图不存在或无权分享。");
  const token = row.grantId ? await new SignJWT({}).setProtectedHeader({ alg: "HS256" })
    .setIssuer(env.AUTH_ORIGIN).setAudience(audience).setSubject(id).setJti(row.grantId).sign(signingKey(env)) : null;
  return json({ token });
}

function publicDocument(doc: MindmapDocument): MindmapDocument {
  const referenced = new Set<string>();
  for (const sheet of doc.sheets) for (const topic of collectAllTopics(sheet).values()) {
    if (topic.image) referenced.add(topic.image.resourceId);
  }
  return { ...doc, deletedIds: [], assets: Object.fromEntries(Object.entries(doc.assets).filter(([id]) => referenced.has(id))) };
}

export async function readPublicMap(request: Request, env: Env, id: string) {
  if (request.method !== "GET") return json({ error: "该分享仅供查看。" }, 405, [], { Allow: "GET" });
  const authorization = request.headers.get("Authorization") ?? "";
  if (!MAP_ID.test(id) || !authorization.startsWith("Bearer ") || authorization.length > 1024) throw unavailable();
  let grant: string | undefined;
  try {
    const { payload } = await jwtVerify(authorization.slice(7), signingKey(env), {
      algorithms: ["HS256"], audience, issuer: env.AUTH_ORIGIN, subject: id, requiredClaims: ["jti"],
    });
    grant = payload.jti;
  } catch (reason) {
    if (reason instanceof errors.JOSEError) throw unavailable();
    throw reason;
  }
  if (!grant || !MAP_ID.test(grant)) throw unavailable();
  const db = database(env);
  const known = knownRevision(request);
  const row = await db.prepare(`SELECT revision, CASE WHEN revision = ? THEN '' ELSE document END AS document
    FROM mindmaps WHERE id = ? AND public_view_grant = ?`).bind(known, id, grant).first<{ revision: number; document: string }>();
  if (!row) throw unavailable();
  return snapshotResponse(db, id, row, known, publicDocument);
}
