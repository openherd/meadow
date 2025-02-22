import { StringType, DateType } from 'indexdb-prisma';
import { z } from "zod";

export const schemaMockup = {
  posts: {
    id: StringType,
    text: StringType,
    importedAt: DateType,
    latitude: StringType,
    longitude: StringType,
    publicKey: StringType,
    privateKey: StringType,
    createdAt: DateType,
    parent: StringType,
    signature: StringType,
    raw: StringType
  },
}
export const newPost = z.object({
  latitude: z.union([z.string(), z.number()]),
  longitude: z.union([z.string(), z.number()]),
  text: z.string(),
  date: z.string(),
  parent: z.string().optional(),
});
export const newPostEnvelope = z.object({

  signature: z.string(),
  publicKey: z.string(),
  id: z.string(),
});
export default {
    schemaMockup
}