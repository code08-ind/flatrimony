/** Supabase Storage with the service-role key (server side only, like the API). */
import { StorageClient } from '@supabase/storage-js';
import type { ObjectRemover } from './tasks/photo-uploads.js';

export function supabaseStorage(supabaseUrl: string, serviceRoleKey: string): ObjectRemover {
  const client = new StorageClient(`${supabaseUrl.replace(/\/$/, '')}/storage/v1`, {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
  });
  return {
    async remove(bucket, keys) {
      if (keys.length === 0) return;
      const { error } = await client.from(bucket).remove(keys);
      if (error) throw error;
    },
  };
}
