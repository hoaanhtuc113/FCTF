import { Layout } from '../components/Layout';
import { Typography } from '@mui/material';

export function Tickets() {
  return (
    <Layout>
      <Typography variant="h4" className="font-bold text-gray-800">
        Support Tickets
      </Typography>
      <Typography className="text-gray-600 mt-2">
        Your support tickets will be displayed here
      </Typography>
    </Layout>
  );
}