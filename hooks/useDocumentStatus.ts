import { useState, useCallback } from 'react';
import { donorService } from '../services/donorService';
import { DocumentStatusData } from '../types';

export interface UseDocumentStatusResult {
  data: DocumentStatusData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useDocumentStatus(): UseDocumentStatusResult {
  const [data, setData] = useState<DocumentStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await donorService.getDocumentStatus();
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(res.message ?? 'Failed to load document status.');
      }
    } catch {
      setError('Unable to check document status. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { data, isLoading, error, refetch };
}
