"""Object storage adapter: local filesystem by default, S3-compatible when S3_* settings are set."""

from pathlib import Path

from app.core.config import get_settings


def _s3():
    s = get_settings()
    if not (s.s3_endpoint and s.s3_bucket):
        return None
    import boto3  # optional dependency, installed in production image

    return boto3.client("s3", endpoint_url=s.s3_endpoint, aws_access_key_id=s.s3_access_key, aws_secret_access_key=s.s3_secret_key)


def _path(key: str) -> Path:
    root = Path(get_settings().upload_dir).resolve()
    p = (root / key).resolve()
    if root not in p.parents:
        raise ValueError("invalid storage key")
    return p


def put(key: str, data: bytes) -> None:
    client = _s3()
    if client:
        client.put_object(Bucket=get_settings().s3_bucket, Key=key, Body=data)
        return
    p = _path(key)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


def get(key: str) -> bytes:
    client = _s3()
    if client:
        return client.get_object(Bucket=get_settings().s3_bucket, Key=key)["Body"].read()
    return _path(key).read_bytes()
