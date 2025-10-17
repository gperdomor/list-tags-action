/**
 * Unit tests for DockerHubClient
 */
import type { HttpClient, HttpClientResponse } from '@actions/http-client';
import { jest } from '@jest/globals';
import * as core from '../__fixtures__/core.js';
import type { ActionInputs, DockerHubAuthResponse, DockerHubTag, DockerHubTagsResponse } from '../src/types.js';

// Mock @actions/core
jest.unstable_mockModule('@actions/core', () => core);

// Mock HttpClient
const mockPost = jest.fn<HttpClient['post']>();
const mockGet = jest.fn<HttpClient['get']>();

jest.unstable_mockModule('@actions/http-client', () => ({
  HttpClient: jest.fn().mockImplementation(() => ({
    post: mockPost,
    get: mockGet,
  })),
}));

const { DockerHubClient } = await import('../src/dockerhub-client.js');

describe('DockerHubClient', () => {
  let client: InstanceType<typeof DockerHubClient>;

  beforeEach(() => {
    client = new DockerHubClient();
    jest.clearAllMocks();
  });

  describe('authenticate', () => {
    it('should authenticate successfully with valid credentials', async () => {
      const mockAuthResponse: DockerHubAuthResponse = {
        token: 'test-token-123',
      };

      const mockResponse: Partial<HttpClientResponse> = {
        readBody: jest.fn<() => Promise<string>>().mockResolvedValue(JSON.stringify(mockAuthResponse)),
        message: {
          statusCode: 200,
        } as any,
      };

      mockPost.mockResolvedValue(mockResponse as HttpClientResponse);

      await client.authenticate('testuser', 'testpass');

      expect(mockPost).toHaveBeenCalledWith(
        'https://hub.docker.com/v2/users/login/',
        JSON.stringify({ username: 'testuser', password: 'testpass' }),
        { 'Content-Type': 'application/json' },
      );
      expect(core.info).toHaveBeenCalledWith('Authenticating with Docker Hub...');
      expect(core.info).toHaveBeenCalledWith('✓ Authentication successful');
    });

    it('should handle authentication failure gracefully', async () => {
      const mockAuthResponse: Partial<DockerHubAuthResponse> = {};

      const mockResponse: Partial<HttpClientResponse> = {
        readBody: jest.fn<() => Promise<string>>().mockResolvedValue(JSON.stringify(mockAuthResponse)),
        message: {
          statusCode: 401,
        } as any,
      };

      mockPost.mockResolvedValue(mockResponse as HttpClientResponse);

      await client.authenticate('testuser', 'wrongpass');

      expect(core.warning).toHaveBeenCalledWith('⚠ Authentication failed, proceeding without authentication');
    });

    it('should handle network errors during authentication', async () => {
      const error = new Error('Network error');
      mockPost.mockRejectedValue(error);

      await client.authenticate('testuser', 'testpass');

      expect(core.warning).toHaveBeenCalledWith(
        `⚠ Authentication failed: ${error}, proceeding without authentication`,
      );
    });
  });

  describe('fetchTags', () => {
    const createMockTag = (name: string): DockerHubTag => ({
      creator: 1,
      id: 1,
      images: [],
      last_updated: '2024-01-01T00:00:00Z',
      last_updater: 1,
      last_updater_username: 'test',
      name,
      repository: 1,
      full_size: 1000,
      v2: true,
      tag_status: 'active',
      tag_last_pulled: '2024-01-01T00:00:00Z',
      tag_last_pushed: '2024-01-01T00:00:00Z',
      media_type: 'application/vnd.docker.distribution.manifest.v2+json',
      content_type: 'image',
      digest: 'sha256:abc123',
    });

    const createMockResponse = (tags: DockerHubTag[], next: string | null = null): Partial<HttpClientResponse> => ({
      readBody: jest.fn<() => Promise<string>>().mockResolvedValue(
        JSON.stringify({
          count: tags.length,
          next,
          previous: null,
          results: tags,
        } as DockerHubTagsResponse),
      ),
      message: {
        statusCode: 200,
        statusMessage: 'OK',
      } as any,
    });

    it('should fetch tags for official repository', async () => {
      const mockTags = [createMockTag('latest'), createMockTag('1.0.0')];
      const mockResponse = createMockResponse(mockTags);

      mockGet.mockResolvedValue(mockResponse as HttpClientResponse);

      const inputs: ActionInputs = {
        repository: 'nginx',
        maxResults: 10,
      };

      const result = await client.fetchTags(inputs);

      expect(mockGet).toHaveBeenCalledWith(
        'https://hub.docker.com/v2/repositories/library/nginx/tags?page_size=100',
        {},
      );
      expect(result).toEqual(mockTags);
      expect(core.info).toHaveBeenCalledWith(
        'Fetching from: https://hub.docker.com/v2/repositories/library/nginx/tags',
      );
      expect(core.info).toHaveBeenCalledWith('✓ Fetched 2 tags');
    });

    it('should fetch tags for user/org repository', async () => {
      const mockTags = [createMockTag('latest')];
      const mockResponse = createMockResponse(mockTags);

      mockGet.mockResolvedValue(mockResponse as HttpClientResponse);

      const inputs: ActionInputs = {
        repository: 'myuser/myapp',
        maxResults: 10,
      };

      const result = await client.fetchTags(inputs);

      expect(mockGet).toHaveBeenCalledWith(
        'https://hub.docker.com/v2/repositories/myuser/myapp/tags?page_size=100',
        {},
      );
      expect(result).toEqual(mockTags);
    });

    it('should include authorization header when authenticated', async () => {
      const mockAuthResponse: DockerHubAuthResponse = {
        token: 'test-token-123',
      };

      const mockAuthResponseObj: Partial<HttpClientResponse> = {
        readBody: jest.fn<() => Promise<string>>().mockResolvedValue(JSON.stringify(mockAuthResponse)),
        message: {
          statusCode: 200,
        } as any,
      };

      mockPost.mockResolvedValue(mockAuthResponseObj as HttpClientResponse);

      await client.authenticate('testuser', 'testpass');

      const mockTags = [createMockTag('latest')];
      const mockResponse = createMockResponse(mockTags);

      mockGet.mockResolvedValue(mockResponse as HttpClientResponse);

      const inputs: ActionInputs = {
        repository: 'nginx',
        maxResults: 10,
      };

      await client.fetchTags(inputs);

      expect(mockGet).toHaveBeenCalledWith(expect.any(String), { Authorization: 'Bearer test-token-123' });
    });

    it('should handle pagination and fetch multiple pages', async () => {
      const page1Tags = Array.from({ length: 100 }, (_, i) => createMockTag(`tag-${i}`));
      const page2Tags = Array.from({ length: 50 }, (_, i) => createMockTag(`tag-${i + 100}`));

      const mockResponse1 = createMockResponse(
        page1Tags,
        'https://hub.docker.com/v2/repositories/library/nginx/tags?page=2&page_size=100',
      );
      const mockResponse2 = createMockResponse(page2Tags, null);

      mockGet.mockResolvedValueOnce(mockResponse1 as HttpClientResponse);
      mockGet.mockResolvedValueOnce(mockResponse2 as HttpClientResponse);

      const inputs: ActionInputs = {
        repository: 'nginx',
        maxResults: 150,
      };

      const result = await client.fetchTags(inputs);

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(150);
      expect(core.debug).toHaveBeenCalledWith(
        'Fetching page: https://hub.docker.com/v2/repositories/library/nginx/tags?page_size=100',
      );
      expect(core.debug).toHaveBeenCalledWith(
        'Fetching page: https://hub.docker.com/v2/repositories/library/nginx/tags?page=2&page_size=100',
      );
    });

    it('should respect maxResults limit across pages', async () => {
      const page1Tags = Array.from({ length: 100 }, (_, i) => createMockTag(`tag-${i}`));
      const page2Tags = Array.from({ length: 100 }, (_, i) => createMockTag(`tag-${i + 100}`));

      const mockResponse1 = createMockResponse(
        page1Tags,
        'https://hub.docker.com/v2/repositories/library/nginx/tags?page=2&page_size=100',
      );
      const mockResponse2 = createMockResponse(page2Tags, null);

      mockGet.mockResolvedValueOnce(mockResponse1 as HttpClientResponse);
      mockGet.mockResolvedValueOnce(mockResponse2 as HttpClientResponse);

      const inputs: ActionInputs = {
        repository: 'nginx',
        maxResults: 120,
      };

      const result = await client.fetchTags(inputs);

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(120);
      expect(core.info).toHaveBeenCalledWith('Reached maximum results limit: 120');
    });

    it('should include ordering parameter when provided', async () => {
      const mockTags = [createMockTag('latest')];
      const mockResponse = createMockResponse(mockTags);

      mockGet.mockResolvedValue(mockResponse as HttpClientResponse);

      const inputs: ActionInputs = {
        repository: 'nginx',
        maxResults: 10,
        ordering: '-last_updated',
      };

      await client.fetchTags(inputs);

      expect(mockGet).toHaveBeenCalledWith(
        'https://hub.docker.com/v2/repositories/library/nginx/tags?page_size=100&ordering=-last_updated',
        {},
      );
    });

    it('should include name filter parameter when provided', async () => {
      const mockTags = [createMockTag('1.0.0')];
      const mockResponse = createMockResponse(mockTags);

      mockGet.mockResolvedValue(mockResponse as HttpClientResponse);

      const inputs: ActionInputs = {
        repository: 'nginx',
        maxResults: 10,
        name: '1.0',
      };

      await client.fetchTags(inputs);

      expect(mockGet).toHaveBeenCalledWith(
        'https://hub.docker.com/v2/repositories/library/nginx/tags?page_size=100&name=1.0',
        {},
      );
    });

    it('should include both ordering and name parameters when provided', async () => {
      const mockTags = [createMockTag('1.0.0')];
      const mockResponse = createMockResponse(mockTags);

      mockGet.mockResolvedValue(mockResponse as HttpClientResponse);

      const inputs: ActionInputs = {
        repository: 'nginx',
        maxResults: 10,
        ordering: '-last_updated',
        name: '1.0',
      };

      await client.fetchTags(inputs);

      expect(mockGet).toHaveBeenCalledWith(
        'https://hub.docker.com/v2/repositories/library/nginx/tags?page_size=100&ordering=-last_updated&name=1.0',
        {},
      );
    });

    it('should handle HTTP errors', async () => {
      const mockResponse: Partial<HttpClientResponse> = {
        readBody: jest.fn<() => Promise<string>>().mockResolvedValue(''),
        message: {
          statusCode: 404,
          statusMessage: 'Not Found',
        } as any,
      };

      mockGet.mockResolvedValue(mockResponse as HttpClientResponse);

      const inputs: ActionInputs = {
        repository: 'nonexistent/repo',
        maxResults: 10,
      };

      await expect(client.fetchTags(inputs)).rejects.toThrow('HTTP 404: Not Found');
    });

    it('should handle invalid API responses', async () => {
      const mockResponse: Partial<HttpClientResponse> = {
        readBody: jest.fn<() => Promise<string>>().mockResolvedValue(JSON.stringify({ invalid: 'response' })),
        message: {
          statusCode: 200,
        } as any,
      };

      mockGet.mockResolvedValue(mockResponse as HttpClientResponse);

      const inputs: ActionInputs = {
        repository: 'nginx',
        maxResults: 10,
      };

      await expect(client.fetchTags(inputs)).rejects.toThrow('Invalid response from Docker Hub API');
    });

    it('should handle network errors', async () => {
      const error = new Error('Network error');
      mockGet.mockRejectedValue(error);

      const inputs: ActionInputs = {
        repository: 'nginx',
        maxResults: 10,
      };

      await expect(client.fetchTags(inputs)).rejects.toThrow('Failed to fetch tags: Error: Network error');
    });

    it('should handle empty results', async () => {
      const mockResponse = createMockResponse([]);

      mockGet.mockResolvedValue(mockResponse as HttpClientResponse);

      const inputs: ActionInputs = {
        repository: 'nginx',
        maxResults: 10,
      };

      const result = await client.fetchTags(inputs);

      expect(result).toEqual([]);
      expect(core.info).toHaveBeenCalledWith('✓ Fetched 0 tags');
    });

    it('should stop pagination when no more pages exist', async () => {
      const mockTags = [createMockTag('latest')];
      const mockResponse = createMockResponse(mockTags, null);

      mockGet.mockResolvedValue(mockResponse as HttpClientResponse);

      const inputs: ActionInputs = {
        repository: 'nginx',
        maxResults: 100,
      };

      const result = await client.fetchTags(inputs);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
    });
  });
});
