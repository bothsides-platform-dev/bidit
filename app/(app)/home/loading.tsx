import { HomeDashboardSkeleton } from '@/components/home/HomeDashboard';

export default function Loading() {
  return (
    <div className="px-8 py-10">
      <HomeDashboardSkeleton />
    </div>
  );
}
