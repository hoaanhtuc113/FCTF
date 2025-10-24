import { Layout } from '../components/Layout';
import { Typography } from '@mui/material';

export function Scoreboard() {
  return (
    <Layout>
      <Typography variant="h4" className="font-bold text-gray-800">
        Scoreboard
      </Typography>
      <Typography className="text-gray-600 mt-2">
        Team standings will be displayed here
      </Typography>
    </Layout>
  );
}