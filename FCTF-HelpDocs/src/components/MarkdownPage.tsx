import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface MarkdownPageProps {
  content: string;
}

export default function MarkdownPage({ content }: MarkdownPageProps) {
  return (
    <article className="prose prose-slate prose-fptorange max-w-none 
      prose-headings:font-semibold prose-headings:tracking-tight 
      prose-a:text-fptorange hover:prose-a:text-orange-600 prose-a:font-medium
      prose-img:rounded-xl prose-img:shadow-md
      prose-table:border prose-table:border-gray-200 prose-table:rounded-lg prose-table:shadow-sm
      prose-th:bg-gray-50 prose-th:px-4 prose-th:py-3 prose-th:text-left
      prose-td:px-4 prose-td:py-3 prose-td:border-t prose-td:border-gray-200
      prose-blockquote:border-l-4 prose-blockquote:border-fptorange prose-blockquote:bg-orange-50 prose-blockquote:py-1 prose-blockquote:pr-4 prose-blockquote:pl-6 prose-blockquote:rounded-r-lg prose-blockquote:text-gray-700 prose-blockquote:not-italic
    ">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]} 
        rehypePlugins={[rehypeRaw]}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
