import { useState, useCallback } from 'react';
import { donorService } from '../services/donorService';
import { EligibilityStatusData } from '../types';

export interface UseEligibilityResult {
  data: EligibilityStatusData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useEligibility(): UseEligibilityResult {
  const [data, setData] = useState<EligibilityStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await donorService.getEligibilityStatus();
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(res.message ?? 'Failed to load eligibility status.');
      }
    } catch {
      setError('Unable to verify eligibility. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { data, isLoading, error, refetch };
}
