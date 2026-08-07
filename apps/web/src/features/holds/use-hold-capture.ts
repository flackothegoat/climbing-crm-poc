'use client';

import { useState, type ChangeEvent } from 'react';
import {
  cancelHoldScan,
  uploadHoldModelPreview,
  uploadHoldScanAsset,
  type HoldAsset,
  type HoldScan,
} from './hold-api';
import { createPreviewFile, holdModelPreviewConfig } from './hold-model-preview';

export type HoldPreviewStatus = 'IDLE' | 'GENERATING' | 'UPLOADING' | 'READY' | 'FAILED';

export function useHoldCapture(createDraft: () => Promise<HoldScan>) {
  const [draftId, setDraftId] = useState('');
  const [modelAsset, setModelAsset] = useState<HoldAsset | null>(null);
  const [previewAsset, setPreviewAsset] = useState<HoldAsset | null>(null);
  const [previewStatus, setPreviewStatus] = useState<HoldPreviewStatus>('IDLE');
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [photos, setPhotos] = useState<HoldAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  async function ensureDraft(): Promise<string> {
    if (draftId) return draftId;
    const draft = await createDraft();
    setDraftId(draft.id);
    return draft.id;
  }

  async function uploadModel(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    await runUpload(async () => {
      const id = await ensureDraft();
      const uploadedModel = await uploadHoldScanAsset(id, 'MODEL_3D', file);
      setModelAsset(uploadedModel);
      setPreviewAsset(null);
      setPreviewStatus('GENERATING');
    });
  }

  async function uploadPhotos(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    await runUpload(async () => {
      const id = await ensureDraft();
      const uploaded = await uploadFiles(id, files);
      setPhotos((current) => [...current, ...uploaded]);
    });
    event.target.value = '';
  }

  async function cancel(): Promise<void> {
    if (draftId) await cancelHoldScan(draftId);
  }

  async function saveModelPreview(blob: Blob): Promise<void> {
    if (!modelAsset) throw new Error('请先上传主 3D 模型');
    setPreviewStatus('UPLOADING');
    const file = createPreviewFile(blob, modelAsset.originalFileName);
    try {
      const uploaded = await uploadHoldModelPreview(
        modelAsset.id,
        holdModelPreviewConfig.generationVersion,
        file,
      );
      setPreviewAsset(uploaded);
      setPreviewStatus('READY');
    } catch (error) {
      setPreviewStatus('FAILED');
      throw error;
    }
  }

  function failModelPreview(error: unknown): void {
    setPreviewStatus('FAILED');
    setMessage(toMessage(error, '俯瞰缩略图生成失败，请重试'));
  }

  function retryModelPreview(): void {
    setMessage('');
    setPreviewStatus('GENERATING');
    setPreviewAttempt((value) => value + 1);
  }

  async function runUpload(action: () => Promise<void>): Promise<void> {
    setUploading(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(toMessage(error, '文件上传失败'));
    } finally {
      setUploading(false);
    }
  }

  return {
    draftId,
    modelAsset,
    previewAsset,
    previewAttempt,
    previewStatus,
    photos,
    uploading,
    message,
    setMessage,
    uploadModel,
    uploadPhotos,
    saveModelPreview,
    failModelPreview,
    retryModelPreview,
    cancel,
  };
}

async function uploadFiles(scanId: string, files: File[]): Promise<HoldAsset[]> {
  const uploaded: HoldAsset[] = [];
  for (const file of files) {
    uploaded.push(await uploadHoldScanAsset(scanId, 'PHOTO_OTHER', file));
  }
  return uploaded;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
