import { Request, Response } from 'express';
import * as searchService from '../services/search.service';
import { sendSuccess } from '../utils/response.util';

export const globalSearch = async (req: Request, res: Response) => {
  const query = req.query.q as string;
  const results = await searchService.globalSearch(query || '');
  sendSuccess(res, 200, 'Search results retrieved', results);
};
