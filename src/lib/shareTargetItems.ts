import * as FileSystem from 'expo-file-system/legacy';

import { formatBytes } from './format';
import { SharedIntentItem } from '../types/navigation';

export function isUsableSharedItem(item: SharedIntentItem) {
  return (item.kind === 'text' && !!item.text?.trim()) || (item.kind === 'file' && !!item.uri);
}

export async function prepareSharedItem(item: SharedIntentItem): Promise<SharedIntentItem> {
  if (item.kind === 'text') {
    return item;
  }

  return prepareSharedFileItem(item);
}

export function formatShareSummary(textItems: SharedIntentItem[], fileItems: SharedIntentItem[]) {
  if (fileItems.length > 0 && textItems.length > 0) {
    return `${fileItems.length} attachment${fileItems.length === 1 ? '' : 's'} and text`;
  }

  if (fileItems.length > 0) {
    return `${fileItems.length} attachment${fileItems.length === 1 ? '' : 's'}`;
  }

  return 'Shared text';
}

export function formatShareSubtitle(textItems: SharedIntentItem[], fileItems: SharedIntentItem[]) {
  if (fileItems.length === 1) {
    const file = fileItems[0];
    const sizeLabel = file.sizeBytes ? ` • ${formatBytes(file.sizeBytes)}` : '';
    return `${file.fileName || 'File'}${sizeLabel}`;
  }

  if (fileItems.length > 1) {
    return fileItems.map((item) => item.fileName || 'File').slice(0, 3).join(', ');
  }

  return textItems.map((item) => item.text?.trim()).filter(Boolean).join('\n');
}

async function getSharedItemSize(item: SharedIntentItem) {
  if (item.sizeBytes && item.sizeBytes > 0) {
    return item.sizeBytes;
  }

  if (!item.uri) {
    return 0;
  }

  const info = await FileSystem.getInfoAsync(item.uri);
  return info.exists && 'size' in info && info.size ? info.size : 0;
}

async function prepareSharedFileItem(item: SharedIntentItem): Promise<SharedIntentItem> {
  if (item.kind !== 'file' || !item.uri) {
    return item;
  }

  const fileName = item.fileName || getFileNameFromUri(item.uri);
  const mimeType = item.mimeType || 'application/octet-stream';
  const sizeBytes = await getSharedItemSize(item);
  const stableUri = await copySharedItemToCache(item.uri, fileName);

  return {
    ...item,
    fileName,
    mimeType,
    sizeBytes,
    uri: stableUri,
  };
}

async function copySharedItemToCache(uri: string, fileName: string) {
  if (!uri) {
    return uri;
  }

  const cacheRoot = FileSystem.cacheDirectory || FileSystem.documentDirectory;

  if (!cacheRoot) {
    return uri;
  }

  if (!/^file:/i.test(uri) && !/^content:/i.test(uri)) {
    return uri;
  }

  const targetUri = `${cacheRoot}shared-target-${Date.now()}-${Math.random().toString(36).slice(2)}-${sanitizeShareFileName(fileName)}`;

  try {
    await FileSystem.copyAsync({ from: uri, to: targetUri });
    return targetUri;
  } catch {
    return uri;
  }
}

function sanitizeShareFileName(fileName: string) {
  const safeFileName = fileName.replace(/[^A-Za-z0-9._-]/g, '_').trim();
  return safeFileName || 'shared-file';
}

function getFileNameFromUri(uri: string) {
  const cleanUri = uri.split('?')[0];
  const name = decodeURIComponent(cleanUri.substring(cleanUri.lastIndexOf('/') + 1));
  return name || 'shared-file';
}
