/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * To mock dependencies in ESM, you can create fixtures that export mock
 * functions and objects. For example, the core module is mocked in this test,
 * so that the actual '@actions/core' module is not imported.
 */
import { jest } from '@jest/globals';
import * as core from '../__fixtures__/core.js';
import type { ActionInputs, DockerHubTag } from '../src/types.js';

// Mock DockerHubClient
const mockAuthenticate = jest.fn<() => Promise<void>>();
const mockFetchTags = jest.fn<(inputs: ActionInputs) => Promise<DockerHubTag[]>>();

jest.unstable_mockModule('../src/dockerhub-client.js', () => ({
  DockerHubClient: jest.fn().mockImplementation(() => ({
    authenticate: mockAuthenticate,
    fetchTags: mockFetchTags,
  })),
}));

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core);

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run } = await import('../src/main.js');

describe('main.ts', () => {
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

  beforeEach(() => {
    // Default mock implementation for getInput
    core.getInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        repository: 'nginx',
        'max-results': '200',
      };
      return inputs[name] || '';
    });

    mockAuthenticate.mockResolvedValue(undefined);
    mockFetchTags.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic functionality', () => {
    it('should fetch and output tags successfully', async () => {
      const mockTags = [createMockTag('1.0.0'), createMockTag('1.1.0'), createMockTag('2.0.0')];

      mockFetchTags.mockResolvedValue(mockTags);

      await run();

      expect(core.getInput).toHaveBeenCalledWith('repository', { required: true });
      expect(mockFetchTags).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('tags', JSON.stringify(['1.0.0', '1.1.0', '2.0.0']));
      expect(core.setOutput).toHaveBeenCalledWith('latest-tag', '2.0.0');
      expect(core.setOutput).toHaveBeenCalledWith('tag-count', 3);
      expect(core.info).toHaveBeenCalledWith('✓ Found 3 tags');
      expect(core.info).toHaveBeenCalledWith('Latest tag: 2.0.0');
    });

    it('should handle empty results', async () => {
      mockFetchTags.mockResolvedValue([]);

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('tags', JSON.stringify([]));
      expect(core.setOutput).toHaveBeenCalledWith('latest-tag', '');
      expect(core.setOutput).toHaveBeenCalledWith('tag-count', 0);
      expect(core.info).toHaveBeenCalledWith('✓ Found 0 tags');
    });

    it('should authenticate when credentials are provided', async () => {
      core.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          repository: 'nginx',
          username: 'testuser',
          password: 'testpass',
          'max-results': '200',
        };
        return inputs[name] || '';
      });

      mockFetchTags.mockResolvedValue([createMockTag('latest')]);

      await run();

      expect(mockAuthenticate).toHaveBeenCalledWith('testuser', 'testpass');
    });

    it('should not authenticate when credentials are not provided', async () => {
      mockFetchTags.mockResolvedValue([createMockTag('latest')]);

      await run();

      expect(mockAuthenticate).not.toHaveBeenCalled();
    });
  });

  describe('Semver sorting', () => {
    it('should sort tags using semver', async () => {
      const mockTags = [createMockTag('2.0.0'), createMockTag('1.0.0'), createMockTag('1.1.0'), createMockTag('1.0.1')];

      mockFetchTags.mockResolvedValue(mockTags);

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('tags', JSON.stringify(['1.0.0', '1.0.1', '1.1.0', '2.0.0']));
      expect(core.setOutput).toHaveBeenCalledWith('latest-tag', '2.0.0');
    });

    it('should fallback to lexicographic sort when semver fails', async () => {
      const mockTags = [createMockTag('latest'), createMockTag('main'), createMockTag('dev'), createMockTag('beta')];

      mockFetchTags.mockResolvedValue(mockTags);

      await run();

      expect(core.debug).toHaveBeenCalledWith(expect.stringContaining('Semver sort failed, using lexicographic sort'));
      expect(core.setOutput).toHaveBeenCalledWith('tags', JSON.stringify(['beta', 'dev', 'latest', 'main']));
      expect(core.setOutput).toHaveBeenCalledWith('latest-tag', 'main');
    });

    it('should handle mixed semver and non-semver tags with fallback', async () => {
      const mockTags = [
        createMockTag('v2.0.0'),
        createMockTag('latest'),
        createMockTag('v1.0.0'),
        createMockTag('main'),
      ];

      mockFetchTags.mockResolvedValue(mockTags);

      await run();

      expect(core.debug).toHaveBeenCalledWith(expect.stringContaining('Semver sort failed, using lexicographic sort'));
      // Lexicographic sort
      expect(core.setOutput).toHaveBeenCalledWith('tags', JSON.stringify(['latest', 'main', 'v1.0.0', 'v2.0.0']));
      expect(core.setOutput).toHaveBeenCalledWith('tag-count', 4);
    });
  });

  describe('Filtering', () => {
    it('should filter tags based on regex pattern', async () => {
      core.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          repository: 'nginx',
          'max-results': '200',
          filter: '^v\\d+\\.\\d+\\.\\d+$',
        };
        return inputs[name] || '';
      });

      const mockTags = [
        createMockTag('v1.0.0'),
        createMockTag('v1.1.0'),
        createMockTag('latest'),
        createMockTag('main'),
        createMockTag('v2.0.0'),
      ];

      mockFetchTags.mockResolvedValue(mockTags);

      await run();

      expect(core.info).toHaveBeenCalledWith('Applying filter: ^v\\d+\\.\\d+\\.\\d+$');
      expect(core.setOutput).toHaveBeenCalledWith('tags', JSON.stringify(['v1.0.0', 'v1.1.0', 'v2.0.0']));
      expect(core.setOutput).toHaveBeenCalledWith('tag-count', 3);
    });

    it('should handle invalid filter pattern gracefully', async () => {
      core.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          repository: 'nginx',
          'max-results': '200',
          filter: '[invalid(regex',
        };
        return inputs[name] || '';
      });

      const mockTags = [createMockTag('latest')];

      mockFetchTags.mockResolvedValue(mockTags);

      await run();

      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Invalid filter pattern'));
      expect(core.setOutput).toHaveBeenCalledWith('tags', JSON.stringify(['latest']));
    });

    it('should not apply filter when not provided', async () => {
      // const mockTags = [createMockTag('latest'), createMockTag('main'), createMockTag('v1.0.0')];
      const mockTags = [createMockTag('v1.2.3'), createMockTag('v1.1.0'), createMockTag('v1.0.0')];

      mockFetchTags.mockResolvedValue(mockTags);

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('tag-count', 3);
    });
  });

  describe('Duplicate handling', () => {
    it('should remove duplicate tags', async () => {
      const mockTags = [
        createMockTag('latest'),
        createMockTag('latest'),
        createMockTag('1.0.0'),
        createMockTag('1.0.0'),
      ];

      mockFetchTags.mockResolvedValue(mockTags);

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('tags', JSON.stringify(['1.0.0', 'latest']));
      expect(core.setOutput).toHaveBeenCalledWith('tag-count', 2);
    });
  });

  describe('Output display', () => {
    it('should display first 20 tags when there are more than 20', async () => {
      const mockTags = Array.from({ length: 25 }, (_, i) => createMockTag(`v${i}.0.0`));

      mockFetchTags.mockResolvedValue(mockTags);

      await run();

      expect(core.info).toHaveBeenCalledWith('✓ Found 25 tags');
      expect(core.info).toHaveBeenCalledWith('... and 5 more');
    });

    it('should display all tags when there are 20 or fewer', async () => {
      const mockTags = Array.from({ length: 5 }, (_, i) => createMockTag(`v${i}.0.0`));

      mockFetchTags.mockResolvedValue(mockTags);

      await run();

      expect(core.info).toHaveBeenCalledWith('✓ Found 5 tags');
      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining('and'));
    });
  });

  describe('Input parsing', () => {
    it('should parse max-results input correctly', async () => {
      core.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          repository: 'nginx',
          'max-results': '50',
        };
        return inputs[name] || '';
      });

      mockFetchTags.mockResolvedValue([createMockTag('latest')]);

      await run();

      expect(mockFetchTags).toHaveBeenCalled();
      const inputs = mockFetchTags.mock.calls[0]?.[0];
      expect(inputs?.maxResults).toBe(50);
    });

    it('should use default max-results when not provided', async () => {
      mockFetchTags.mockResolvedValue([createMockTag('latest')]);

      await run();

      expect(mockFetchTags).toHaveBeenCalled();
      const inputs = mockFetchTags.mock.calls[0]?.[0];
      expect(inputs?.maxResults).toBe(200);
    });

    it('should pass ordering parameter to client', async () => {
      core.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          repository: 'nginx',
          'max-results': '200',
          ordering: '-last_updated',
        };
        return inputs[name] || '';
      });

      mockFetchTags.mockResolvedValue([createMockTag('latest')]);

      await run();

      expect(mockFetchTags).toHaveBeenCalled();
      const inputs = mockFetchTags.mock.calls[0]?.[0];
      expect(inputs?.ordering).toBe('-last_updated');
    });

    it('should pass name parameter to client', async () => {
      core.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          repository: 'nginx',
          'max-results': '200',
          name: '1.0',
        };
        return inputs[name] || '';
      });

      mockFetchTags.mockResolvedValue([createMockTag('1.0.0')]);

      await run();

      expect(mockFetchTags).toHaveBeenCalled();
      const inputs = mockFetchTags.mock.calls[0]?.[0];
      expect(inputs?.name).toBe('1.0');
    });
  });

  describe('Error handling', () => {
    it('should handle errors from DockerHubClient', async () => {
      const error = new Error('Failed to fetch tags');
      mockFetchTags.mockRejectedValue(error);

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('❌ Error: Failed to fetch tags');
    });

    it('should handle non-Error exceptions', async () => {
      mockFetchTags.mockRejectedValue('String error');

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('❌ Error: String error');
    });

    it('should handle authentication errors gracefully', async () => {
      core.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          repository: 'nginx',
          username: 'testuser',
          password: 'wrongpass',
          'max-results': '200',
        };
        return inputs[name] || '';
      });

      mockAuthenticate.mockRejectedValue(new Error('Authentication failed'));
      mockFetchTags.mockResolvedValue([createMockTag('latest')]);

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('❌ Error: Authentication failed');
    });
  });

  describe('Edge cases', () => {
    it('should handle tags with empty names', async () => {
      const mockTags = [createMockTag('1.0.0'), { ...createMockTag(''), name: '' }, createMockTag('2.0.0')];

      mockFetchTags.mockResolvedValue(mockTags);

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('tags', JSON.stringify(['1.0.0', '2.0.0']));
      expect(core.setOutput).toHaveBeenCalledWith('tag-count', 2);
    });

    it('should handle repository name correctly', async () => {
      core.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          repository: 'myorg/myrepo',
          'max-results': '200',
        };
        return inputs[name] || '';
      });

      mockFetchTags.mockResolvedValue([createMockTag('latest')]);

      await run();

      expect(core.info).toHaveBeenCalledWith('Fetching tags for Docker Hub repository: myorg/myrepo');
      expect(mockFetchTags).toHaveBeenCalled();
      const inputs = mockFetchTags.mock.calls[0]?.[0];
      expect(inputs?.repository).toBe('myorg/myrepo');
    });
  });
});
