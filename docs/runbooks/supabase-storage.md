# Supabase Storage: profile photos (T2.10)

Profile photos live in the private bucket `profile-photos` (docs/04 §7.1). Locally the bucket comes
from `supabase/config.toml`; create it once with:

```bash
pnpm exec supabase seed buckets
```

## Staging and production

Do this once per Supabase project (dashboard → Storage → New bucket, or the SQL below as the project
owner). Never make the bucket public.

| Setting | Value |
| --- | --- |
| Name / id | `profile-photos` |
| Public | **No** |
| File size limit | 8 MB |
| Allowed MIME types | `image/jpeg`, `image/webp` |

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 8388608, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;
```

Add **no** storage policies for `anon` or `authenticated`: only the API reaches the bucket, with the
service-role key, and hands out signed upload URLs (2 h, Supabase default) and signed view URLs (1 h).

The API needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Secret Manager). Without them the
photo routes answer 503.

## Check

1. `GET /storage/v1/bucket` with the service-role key lists `profile-photos` with `public: false`.
2. Reading `/storage/v1/object/profile-photos/<any key>` with the anon key fails.
3. Upload a photo through the app and confirm `Me.photos[0].url` opens and the file has no EXIF.
