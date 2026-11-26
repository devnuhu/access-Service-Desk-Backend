using ServiceDeskAPI.Infrastructure.Tickets;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>What a comment notification shows of the comment.</summary>
    public class CommentExcerptTests
    {
        [Fact]
        public void A_short_comment_is_shown_in_quotes_on_one_line()
        {
            Assert.Equal(": \"Please send the signed form.\".", CommentExcerpt.For("  Please send\n the   signed form.  "));
        }

        [Fact]
        public void Nothing_to_show_leaves_just_a_full_stop()
        {
            Assert.Equal(".", CommentExcerpt.For(null));
            Assert.Equal(".", CommentExcerpt.For("   \n  "));
        }

        [Fact]
        public void A_long_comment_is_cut_and_marked()
        {
            var result = CommentExcerpt.For(new string('a', 500));
            Assert.Equal(": \"" + new string('a', CommentExcerpt.MaxLength) + "...\".", result);
        }

        [Fact]
        public void An_RSA_PIN_is_masked_to_its_last_four_digits()
        {
            var result = CommentExcerpt.For("Member pen100123456789 has no record.");
            Assert.Contains("PEN********6789", result);
            Assert.DoesNotContain("100123456789", result);
        }
    }
}