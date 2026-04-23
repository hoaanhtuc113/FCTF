using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Pomelo.EntityFrameworkCore.MySql.Scaffolding.Internal;
using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class AppDbContext : DbContext
{
    public AppDbContext()
    {
    }

    public AppDbContext(DbContextOptions<AppDbContext> options)
        : base(options)
    {
    }

    // --- Existing tables ---
    public virtual DbSet<Achievement> Achievements { get; set; }
    public virtual DbSet<ActionLog> ActionLogs { get; set; }
    public virtual DbSet<AlembicVersion> AlembicVersions { get; set; }
    public virtual DbSet<Award> Awards { get; set; }
    public virtual DbSet<AwardBadge> AwardBadges { get; set; }
    public virtual DbSet<Bracket> Brackets { get; set; }
    public virtual DbSet<Challenge> Challenges { get; set; }
    public virtual DbSet<ChallengeStartTracking> ChallengeStartTrackings { get; set; }
    public virtual DbSet<ChallengeTopic> ChallengeTopics { get; set; }
    public virtual DbSet<Comment> Comments { get; set; }
    public virtual DbSet<Config> Configs { get; set; }
    public virtual DbSet<DeployHistory> DeployHistories { get; set; }
    public virtual DbSet<DynamicChallenge> DynamicChallenges { get; set; }
    public virtual DbSet<Field> Fields { get; set; }
    public virtual DbSet<FieldEntry> FieldEntries { get; set; }
    public virtual DbSet<File> Files { get; set; }
    public virtual DbSet<Flag> Flags { get; set; }
    public virtual DbSet<Hint> Hints { get; set; }
    public virtual DbSet<MultipleChoiceChallenge> MultipleChoiceChallenges { get; set; }
    public virtual DbSet<Notification> Notifications { get; set; }
    public virtual DbSet<Solf> Solves { get; set; }
    public virtual DbSet<Submission> Submissions { get; set; }
    public virtual DbSet<Tag> Tags { get; set; }
    public virtual DbSet<Team> Teams { get; set; }
    public virtual DbSet<Ticket> Tickets { get; set; }
    public virtual DbSet<Token> Tokens { get; set; }
    public virtual DbSet<Topic> Topics { get; set; }
    public virtual DbSet<Tracking> Trackings { get; set; }
    public virtual DbSet<Unlock> Unlocks { get; set; }
    public virtual DbSet<User> Users { get; set; }

    // --- New tables (multiple-contest architecture) ---
    public virtual DbSet<Semester> Semesters { get; set; }
    public virtual DbSet<Contest> Contests { get; set; }
    public virtual DbSet<ContestParticipant> ContestParticipants { get; set; }
    public virtual DbSet<ContestsChallenge> ContestsChallenges { get; set; }

    //protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    //{
    //    var builder = new ConfigurationBuilder()
    //            .SetBasePath(Directory.GetCurrentDirectory())
    //            .AddJsonFile("appsettings.json", optional: true, reloadOnChange: true)
    //            .AddEnvironmentVariables();
    //    IConfigurationRoot configuration = builder.Build();

    //    var connectionString = configuration["DB_CONNECTION"] 
    //                        ?? configuration.GetConnectionString("DbConnection");

    //    if (string.IsNullOrEmpty(connectionString))
    //    {
    //        throw new InvalidOperationException("Database connection string not found. Please set DB_CONNECTION environment variable.");
    //    }

    //    optionsBuilder.UseMySql(
    //        connectionString,
    //        new MySqlServerVersion(new Version(10, 11, 0)),
    //        options => options.EnableRetryOnFailure(
    //            maxRetryCount: 5,
    //            maxRetryDelay: TimeSpan.FromSeconds(10),
    //            errorNumbersToAdd: null
    //        )
    //    );
    //}
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder
            .UseCollation("utf8mb4_unicode_ci")
            .HasCharSet("utf8mb4");

        modelBuilder.Entity<Achievement>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");
            entity.ToTable("achievements");
            entity.HasIndex(e => e.AchievementId, "achievement_id");
            entity.HasIndex(e => e.ContestChallengeId, "contest_challenge_id");
            entity.HasIndex(e => e.ContestId, "contest_id");
            entity.HasIndex(e => e.TeamId, "team_id");
            entity.HasIndex(e => e.UserId, "user_id");

            entity.Property(e => e.Id).HasColumnType("int(11)").HasColumnName("id");
            entity.Property(e => e.AchievementId).HasColumnType("int(11)").HasColumnName("achievement_id");
            entity.Property(e => e.ContestChallengeId).HasColumnType("int(11)").HasColumnName("contest_challenge_id");
            entity.Property(e => e.ContestId).HasColumnType("int(11)").HasColumnName("contest_id");
            entity.Property(e => e.Name).HasMaxLength(80).HasColumnName("name");
            entity.Property(e => e.TeamId).HasColumnType("int(11)").HasColumnName("team_id");
            entity.Property(e => e.UserId).HasColumnType("int(11)").HasColumnName("user_id");

            entity.HasOne(d => d.AchievementNavigation).WithMany(p => p.Achievements)
                .HasForeignKey(d => d.AchievementId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("achievements_ibfk_1");

            entity.HasOne(d => d.ContestChallenge).WithMany(p => p.Achievements)
                .HasForeignKey(d => d.ContestChallengeId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("achievements_ibfk_2");

            entity.HasOne(d => d.Team).WithMany(p => p.Achievements)
                .HasForeignKey(d => d.TeamId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("achievements_ibfk_3");

            entity.HasOne(d => d.User).WithMany(p => p.Achievements)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("achievements_ibfk_4");

            entity.HasOne(d => d.Contest).WithMany()
                .HasForeignKey(d => d.ContestId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("achievements_ibfk_contest");
        });

        modelBuilder.Entity<ActionLog>(entity =>
        {
            entity.HasKey(e => e.ActionId).HasName("PRIMARY");

            entity.ToTable("action_logs");

            entity.HasIndex(e => e.UserId, "userId");

            entity.Property(e => e.ActionId)
                .HasColumnType("int(11)")
                .HasColumnName("actionId");
            entity.Property(e => e.ActionDate)
                .HasColumnType("datetime")
                .HasColumnName("actionDate");
            entity.Property(e => e.ActionDetail)
                .HasMaxLength(255)
                .HasColumnName("actionDetail")
                .UseCollation("utf8mb4_general_ci");
            entity.Property(e => e.ActionType)
                .HasColumnType("int(11)")
                .HasColumnName("actionType");
            entity.Property(e => e.TopicName)
                .HasMaxLength(255)
                .HasColumnName("topicName");
            entity.Property(e => e.UserId)
                .HasColumnType("int(11)")
                .HasColumnName("userId");

            entity.HasOne(d => d.User).WithMany(p => p.ActionLogs)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("userId");
        });

        modelBuilder.Entity<AlembicVersion>(entity =>
        {
            entity.HasKey(e => e.VersionNum).HasName("PRIMARY");

            entity.ToTable("alembic_version");

            entity.Property(e => e.VersionNum)
                .HasMaxLength(32)
                .HasColumnName("version_num");
        });

        modelBuilder.Entity<Award>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");
            entity.ToTable("awards");
            entity.HasIndex(e => e.TeamId, "awards_ibfk_1");
            entity.HasIndex(e => e.UserId, "awards_ibfk_2");
            entity.HasIndex(e => e.ContestId, "ix_awards_contest_id");

            entity.Property(e => e.Id).HasColumnType("int(11)").HasColumnName("id");
            entity.Property(e => e.ContestId).HasColumnType("int(11)").HasColumnName("contest_id");
            entity.Property(e => e.Category)
                .HasMaxLength(80)
                .HasColumnName("category");
            entity.Property(e => e.Date)
                .HasMaxLength(6)
                .HasColumnName("date");
            entity.Property(e => e.Description)
                .HasColumnType("text")
                .HasColumnName("description");
            entity.Property(e => e.Icon)
                .HasColumnType("text")
                .HasColumnName("icon");
            entity.Property(e => e.Name)
                .HasMaxLength(80)
                .HasColumnName("name");
            entity.Property(e => e.Requirements)
                .HasColumnType("json")
                .HasColumnName("requirements");
            entity.Property(e => e.TeamId)
                .HasColumnType("int(11)")
                .HasColumnName("team_id");
            entity.Property(e => e.Type)
                .HasMaxLength(80)
                .HasDefaultValueSql("'standard'")
                .HasColumnName("type");
            entity.Property(e => e.UserId)
                .HasColumnType("int(11)")
                .HasColumnName("user_id");
            entity.Property(e => e.Value)
                .HasColumnType("int(11)")
                .HasColumnName("value");

            entity.HasOne(d => d.Contest).WithMany(p => p.Awards)
                .HasForeignKey(d => d.ContestId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("awards_ibfk_contest");

            entity.HasOne(d => d.Team).WithMany(p => p.Awards)
                .HasForeignKey(d => d.TeamId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("awards_ibfk_1");

            entity.HasOne(d => d.User).WithMany(p => p.Awards)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("awards_ibfk_2");
        });

        modelBuilder.Entity<AwardBadge>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");
            entity.ToTable("award_badges");
            entity.HasIndex(e => e.ContestChallengeId, "challenge_id");
            entity.HasIndex(e => e.ContestId, "contest_id");
            entity.HasIndex(e => e.TeamId, "team_id");
            entity.HasIndex(e => e.UserId, "user_id");

            entity.Property(e => e.Id).HasColumnType("int(11)").HasColumnName("id");
            entity.Property(e => e.ContestId).HasColumnType("int(11)").HasColumnName("contest_id");
            entity.Property(e => e.ContestChallengeId).HasColumnType("int(11)").HasColumnName("challenge_id");
            entity.Property(e => e.Name).HasMaxLength(80).HasColumnName("name");
            entity.Property(e => e.TeamId).HasColumnType("int(11)").HasColumnName("team_id");
            entity.Property(e => e.UserId).HasColumnType("int(11)").HasColumnName("user_id");

            entity.HasOne(d => d.Contest).WithMany()
                .HasForeignKey(d => d.ContestId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("award_badges_ibfk_contest");

            entity.HasOne(d => d.ContestChallenge).WithMany(p => p.AwardBadges)
                .HasForeignKey(d => d.ContestChallengeId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("award_badges_ibfk_1");

            entity.HasOne(d => d.Team).WithMany(p => p.AwardBadges)
                .HasForeignKey(d => d.TeamId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("award_badges_ibfk_2");

            entity.HasOne(d => d.User).WithMany(p => p.AwardBadges)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("award_badges_ibfk_3");
        });

        modelBuilder.Entity<Bracket>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("brackets");

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.Description)
                .HasColumnType("text")
                .HasColumnName("description");
            entity.Property(e => e.Name)
                .HasMaxLength(255)
                .HasColumnName("name");
            entity.Property(e => e.Type)
                .HasMaxLength(80)
                .HasColumnName("type");
        });

        modelBuilder.Entity<Challenge>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");
            entity.ToTable("challenges");
            entity.HasIndex(e => e.AuthorId, "author_id");

            entity.Property(e => e.Id).HasColumnType("int(11)").HasColumnName("id");
            entity.Property(e => e.Name).HasMaxLength(80).HasColumnName("name");
            entity.Property(e => e.Description).HasColumnType("text").HasColumnName("description");
            entity.Property(e => e.Category).HasMaxLength(80).HasColumnName("category");
            entity.Property(e => e.Type).HasMaxLength(80).HasColumnName("type");
            entity.Property(e => e.Difficulty).HasColumnType("int(11)").HasColumnName("difficulty");
            entity.Property(e => e.AuthorId).HasColumnType("int(11)").HasColumnName("author_id");
            entity.Property(e => e.Requirements).HasColumnType("json").HasColumnName("requirements");
            entity.Property(e => e.ImageLink).HasColumnType("text").HasColumnName("image_link");
            entity.Property(e => e.DeployFile).HasMaxLength(256).HasColumnName("deploy_file");
            entity.Property(e => e.CpuLimit).HasColumnType("int(11)").HasColumnName("cpu_limit");
            entity.Property(e => e.CpuRequest).HasColumnType("int(11)").HasColumnName("cpu_request");
            entity.Property(e => e.MemoryLimit).HasColumnType("int(11)").HasColumnName("memory_limit");
            entity.Property(e => e.MemoryRequest).HasColumnType("int(11)").HasColumnName("memory_request");
            entity.Property(e => e.UseGvisor).HasColumnName("use_gvisor");
            entity.Property(e => e.HardenContainer).HasColumnName("harden_container");
            entity.Property(e => e.MaxDeployCount).HasColumnType("int(11)").HasColumnName("max_deploy_count");
            entity.Property(e => e.ConnectionProtocol).HasMaxLength(10).HasDefaultValueSql("'http'").HasColumnName("connection_protocol");
            entity.Property(e => e.SharedInstant).HasColumnName("shared_instant").HasDefaultValue(false);
            entity.Property(e => e.IsPublic).HasColumnName("is_public").HasDefaultValue(false);
            entity.Property(e => e.ImportCount).HasColumnType("int(11)").HasColumnName("import_count").HasDefaultValue(0);
            entity.Property(e => e.CreatedAt).HasMaxLength(6).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasMaxLength(6).HasColumnName("updated_at");

            entity.HasOne(d => d.Author).WithMany(p => p.AuthoredChallenges)
                .HasForeignKey(d => d.AuthorId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("challenges_ibfk_2");
        });

        modelBuilder.Entity<ChallengeStartTracking>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");
            entity.ToTable("challenge_start_tracking");
            entity.HasIndex(e => e.ContestChallengeId, "ix_cst_cc_id");
            entity.HasIndex(e => e.ContestId, "contest_id");

            entity.Property(e => e.Id).HasColumnType("int(11)").HasColumnName("id");
            entity.Property(e => e.ContestId).HasColumnType("int(11)").HasColumnName("contest_id");
            entity.Property(e => e.UserId).HasColumnType("int(11)").HasColumnName("user_id");
            entity.Property(e => e.TeamId).HasColumnType("int(11)").HasColumnName("team_id");
            entity.Property(e => e.ContestChallengeId).HasColumnType("int(11)").HasColumnName("contest_challenge_id");
            entity.Property(e => e.StartedAt).HasMaxLength(6).HasColumnName("started_at");
            entity.Property(e => e.StoppedAt).HasMaxLength(6).HasColumnName("stopped_at");
            entity.Property(e => e.Label).HasMaxLength(255).HasColumnName("label");

            entity.HasOne(d => d.Contest).WithMany()
                .HasForeignKey(d => d.ContestId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_challenge_start_tracking_contest_id");

            entity.HasOne(d => d.ContestChallenge).WithMany(p => p.StartTrackings)
                .HasForeignKey(d => d.ContestChallengeId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_challenge_start_tracking_challenge_id");

            entity.HasOne(d => d.Team).WithMany()
                .HasForeignKey(d => d.TeamId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_challenge_start_tracking_team_id");

            entity.HasOne(d => d.User).WithMany()
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_challenge_start_tracking_user_id");
        });

        modelBuilder.Entity<ChallengeTopic>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("challenge_topics");

            entity.HasIndex(e => e.ChallengeId, "challenge_id");

            entity.HasIndex(e => e.TopicId, "topic_id");

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.ChallengeId)
                .HasColumnType("int(11)")
                .HasColumnName("challenge_id");
            entity.Property(e => e.TopicId)
                .HasColumnType("int(11)")
                .HasColumnName("topic_id");

            entity.HasOne(d => d.Challenge).WithMany(p => p.ChallengeTopics)
                .HasForeignKey(d => d.ChallengeId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("challenge_topics_ibfk_1");

            entity.HasOne(d => d.Topic).WithMany(p => p.ChallengeTopics)
                .HasForeignKey(d => d.TopicId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("challenge_topics_ibfk_2");
        });

        modelBuilder.Entity<Comment>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("comments");

            entity.HasIndex(e => e.AuthorId, "author_id");
            entity.HasIndex(e => e.ContestChallengeId, "challenge_id");
            entity.HasIndex(e => e.ContestId, "contest_id");
            entity.HasIndex(e => e.TeamId, "team_id");
            entity.HasIndex(e => e.UserId, "user_id");

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.AuthorId)
                .HasColumnType("int(11)")
                .HasColumnName("author_id");
            entity.Property(e => e.ContestId)
                .HasColumnType("int(11)")
                .HasColumnName("contest_id");
            entity.Property(e => e.ContestChallengeId)
                .HasColumnType("int(11)")
                .HasColumnName("contest_challenge_id");
            entity.Property(e => e.Content)
                .HasColumnType("text")
                .HasColumnName("content");
            entity.Property(e => e.Date)
                .HasMaxLength(6)
                .HasColumnName("date");
            entity.Property(e => e.TeamId)
                .HasColumnType("int(11)")
                .HasColumnName("team_id");
            entity.Property(e => e.Type)
                .HasMaxLength(80)
                .HasColumnName("type");
            entity.Property(e => e.UserId)
                .HasColumnType("int(11)")
                .HasColumnName("user_id");

            entity.HasOne(d => d.Author).WithMany(p => p.CommentAuthors)
                .HasForeignKey(d => d.AuthorId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("comments_ibfk_1");

            entity.HasOne(d => d.ContestChallenge).WithMany()
                .HasForeignKey(d => d.ContestChallengeId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("comments_ibfk_2");

            entity.HasOne(d => d.Contest).WithMany()
                .HasForeignKey(d => d.ContestId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("comments_ibfk_contest");

            entity.HasOne(d => d.Team).WithMany(p => p.Comments)
                .HasForeignKey(d => d.TeamId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("comments_ibfk_4");

            entity.HasOne(d => d.User).WithMany(p => p.CommentUsers)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("comments_ibfk_5");
        });

        modelBuilder.Entity<Config>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("config");

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.Key)
                .HasColumnType("text")
                .HasColumnName("key");
            entity.Property(e => e.Value)
                .HasColumnType("text")
                .HasColumnName("value");
        });

        modelBuilder.Entity<DeployHistory>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");
            entity.ToTable("deploy_histories");
            entity.HasIndex(e => e.ContestChallengeId, "challenge_id");

            entity.Property(e => e.Id).HasColumnType("int(11)").HasColumnName("id");
            entity.Property(e => e.ContestChallengeId).HasColumnType("int(11)").HasColumnName("contest_challenge_id");
            entity.Property(e => e.DeployAt).HasMaxLength(6).HasColumnName("deploy_at");
            entity.Property(e => e.DeployStatus).HasMaxLength(50).HasColumnName("deploy_status");
            entity.Property(e => e.LogContent).HasColumnType("text").HasColumnName("log_content");

            entity.HasOne(d => d.ContestChallenge).WithMany(p => p.DeployHistories)
                .HasForeignKey(d => d.ContestChallengeId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("deploy_histories_ibfk_1");
        });

        modelBuilder.Entity<DynamicChallenge>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("dynamic_challenge");

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.Decay)
                .HasColumnType("int(11)")
                .HasColumnName("decay");
            entity.Property(e => e.Function)
                .HasMaxLength(32)
                .HasColumnName("function");
            entity.Property(e => e.Initial)
                .HasColumnType("int(11)")
                .HasColumnName("initial");
            entity.Property(e => e.Minimum)
                .HasColumnType("int(11)")
                .HasColumnName("minimum");

            entity.HasOne(d => d.IdNavigation).WithOne(p => p.DynamicChallenge)
                .HasForeignKey<DynamicChallenge>(d => d.Id)
                .HasConstraintName("dynamic_challenge_ibfk_1");
        });

        modelBuilder.Entity<Field>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("fields");

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.Description)
                .HasColumnType("text")
                .HasColumnName("description");
            entity.Property(e => e.Editable).HasColumnName("editable");
            entity.Property(e => e.FieldType)
                .HasMaxLength(80)
                .HasColumnName("field_type");
            entity.Property(e => e.Name)
                .HasColumnType("text")
                .HasColumnName("name");
            entity.Property(e => e.Public).HasColumnName("public");
            entity.Property(e => e.Required).HasColumnName("required");
            entity.Property(e => e.Type)
                .HasMaxLength(80)
                .HasColumnName("type");
        });

        modelBuilder.Entity<FieldEntry>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("field_entries");

            entity.HasIndex(e => e.FieldId, "field_id");

            entity.HasIndex(e => e.TeamId, "team_id");

            entity.HasIndex(e => e.UserId, "user_id");

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.FieldId)
                .HasColumnType("int(11)")
                .HasColumnName("field_id");
            entity.Property(e => e.TeamId)
                .HasColumnType("int(11)")
                .HasColumnName("team_id");
            entity.Property(e => e.Type)
                .HasMaxLength(80)
                .HasColumnName("type");
            entity.Property(e => e.UserId)
                .HasColumnType("int(11)")
                .HasColumnName("user_id");
            entity.Property(e => e.Value)
                .HasColumnType("json")
                .HasColumnName("value");

            entity.HasOne(d => d.Field).WithMany(p => p.FieldEntries)
                .HasForeignKey(d => d.FieldId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("field_entries_ibfk_1");

            entity.HasOne(d => d.Team).WithMany(p => p.FieldEntries)
                .HasForeignKey(d => d.TeamId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("field_entries_ibfk_2");

            entity.HasOne(d => d.User).WithMany(p => p.FieldEntries)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("field_entries_ibfk_3");
        });

        modelBuilder.Entity<File>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("files");

            entity.HasIndex(e => e.ChallengeId, "files_ibfk_1");

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.ChallengeId)
                .HasColumnType("int(11)")
                .HasColumnName("challenge_id");
            entity.Property(e => e.Location)
                .HasColumnType("text")
                .HasColumnName("location");
            entity.Property(e => e.Sha1sum)
                .HasMaxLength(40)
                .HasColumnName("sha1sum");
            entity.Property(e => e.Type)
                .HasMaxLength(80)
                .HasColumnName("type");

            entity.HasOne(d => d.Challenge).WithMany(p => p.Files)
                .HasForeignKey(d => d.ChallengeId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("files_ibfk_1");
        });

        modelBuilder.Entity<Flag>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("flags");

            entity.HasIndex(e => e.ChallengeId, "flags_ibfk_1");

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.ChallengeId)
                .HasColumnType("int(11)")
                .HasColumnName("challenge_id");
            entity.Property(e => e.Content)
                .HasColumnType("text")
                .HasColumnName("content");
            entity.Property(e => e.Data)
                .HasColumnType("text")
                .HasColumnName("data");
            entity.Property(e => e.Type)
                .HasMaxLength(80)
                .HasColumnName("type");

            entity.HasOne(d => d.Challenge).WithMany(p => p.Flags)
                .HasForeignKey(d => d.ChallengeId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("flags_ibfk_1");
        });

        modelBuilder.Entity<Hint>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("hints");

            entity.HasIndex(e => e.ChallengeId, "hints_ibfk_1");

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.ChallengeId)
                .HasColumnType("int(11)")
                .HasColumnName("challenge_id");
            entity.Property(e => e.Content)
                .HasColumnType("text")
                .HasColumnName("content");
            entity.Property(e => e.Cost)
                .HasColumnType("int(11)")
                .HasColumnName("cost");
            entity.Property(e => e.Requirements)
                .HasColumnType("json")
                .HasColumnName("requirements");
            entity.Property(e => e.Type)
                .HasMaxLength(80)
                .HasColumnName("type");

            entity.HasOne(d => d.Challenge).WithMany(p => p.Hints)
                .HasForeignKey(d => d.ChallengeId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("hints_ibfk_1");
        });

        modelBuilder.Entity<MultipleChoiceChallenge>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("multiple_choice_challenge");

            entity.Property(e => e.Id)
                .ValueGeneratedNever()
                .HasColumnType("int(11)")
                .HasColumnName("id");

            entity.HasOne(d => d.IdNavigation).WithOne(p => p.MultipleChoiceChallenge)
                .HasForeignKey<MultipleChoiceChallenge>(d => d.Id)
                .HasConstraintName("multiple_choice_challenge_ibfk_1");
        });

        modelBuilder.Entity<Notification>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");
            entity.ToTable("notifications");
            entity.HasIndex(e => e.ContestId, "contest_id");
            entity.HasIndex(e => e.TeamId, "team_id");
            entity.HasIndex(e => e.UserId, "user_id");

            entity.Property(e => e.Id).HasColumnType("int(11)").HasColumnName("id");
            entity.Property(e => e.ContestId).HasColumnType("int(11)").HasColumnName("contest_id");
            entity.Property(e => e.Title).HasColumnType("text").HasColumnName("title");
            entity.Property(e => e.Content).HasColumnType("text").HasColumnName("content");
            entity.Property(e => e.Date).HasMaxLength(6).HasColumnName("date");
            entity.Property(e => e.TeamId).HasColumnType("int(11)").HasColumnName("team_id");
            entity.Property(e => e.UserId).HasColumnType("int(11)").HasColumnName("user_id");

            entity.HasOne(d => d.Contest).WithMany(p => p.Notifications)
                .HasForeignKey(d => d.ContestId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("notifications_ibfk_contest");

            entity.HasOne(d => d.Team).WithMany(p => p.Notifications)
                .HasForeignKey(d => d.TeamId)
                .HasConstraintName("notifications_ibfk_1");

            entity.HasOne(d => d.User).WithMany(p => p.Notifications)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("notifications_ibfk_2");
        });

        modelBuilder.Entity<Solf>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");
            entity.ToTable("solves");
            entity.HasIndex(e => new { e.ContestChallengeId, e.TeamId }, "uq_solves_cc_team").IsUnique();
            entity.HasIndex(e => new { e.ContestChallengeId, e.UserId }, "uq_solves_cc_user").IsUnique();
            entity.HasIndex(e => e.TeamId, "team_id");
            entity.HasIndex(e => e.UserId, "user_id");

            entity.Property(e => e.Id).ValueGeneratedNever().HasColumnType("int(11)").HasColumnName("id");
            entity.Property(e => e.ContestId).HasColumnType("int(11)").HasColumnName("contest_id");
            entity.Property(e => e.ContestChallengeId).HasColumnType("int(11)").HasColumnName("contest_challenge_id");
            entity.Property(e => e.TeamId).HasColumnType("int(11)").HasColumnName("team_id");
            entity.Property(e => e.UserId).HasColumnType("int(11)").HasColumnName("user_id");

            entity.HasOne(d => d.Contest).WithMany(p => p.Solves)
                .HasForeignKey(d => d.ContestId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("solves_ibfk_contest");

            entity.HasOne(d => d.ContestChallenge).WithMany(p => p.Solves)
                .HasForeignKey(d => d.ContestChallengeId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("solves_ibfk_1");

            entity.HasOne(d => d.IdNavigation).WithOne(p => p.Solf)
                .HasForeignKey<Solf>(d => d.Id)
                .HasConstraintName("solves_ibfk_2");

            entity.HasOne(d => d.Team).WithMany(p => p.Solves)
                .HasForeignKey(d => d.TeamId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("solves_ibfk_3");

            entity.HasOne(d => d.User).WithMany(p => p.Solves)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("solves_ibfk_4");
        });

        modelBuilder.Entity<Submission>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");
            entity.ToTable("submissions");
            entity.HasIndex(e => e.ContestChallengeId, "ix_submissions_cc_id");
            entity.HasIndex(e => e.ContestId, "contest_id");
            entity.HasIndex(e => e.TeamId, "team_id");
            entity.HasIndex(e => e.UserId, "user_id");

            entity.Property(e => e.Id).HasColumnType("int(11)").HasColumnName("id");
            entity.Property(e => e.ContestId).HasColumnType("int(11)").HasColumnName("contest_id");
            entity.Property(e => e.ContestChallengeId).HasColumnType("int(11)").HasColumnName("contest_challenge_id");
            entity.Property(e => e.Date).HasMaxLength(6).HasColumnName("date");
            entity.Property(e => e.Ip).HasMaxLength(46).HasColumnName("ip");
            entity.Property(e => e.Provided).HasColumnType("text").HasColumnName("provided");
            entity.Property(e => e.TeamId).HasColumnType("int(11)").HasColumnName("team_id");
            entity.Property(e => e.Type).HasMaxLength(32).HasColumnName("type");
            entity.Property(e => e.UserId).HasColumnType("int(11)").HasColumnName("user_id");

            entity.HasOne(d => d.Contest).WithMany(p => p.Submissions)
                .HasForeignKey(d => d.ContestId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("submissions_ibfk_contest");

            entity.HasOne(d => d.ContestChallenge).WithMany(p => p.Submissions)
                .HasForeignKey(d => d.ContestChallengeId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("submissions_ibfk_1");

            entity.HasOne(d => d.Team).WithMany(p => p.Submissions)
                .HasForeignKey(d => d.TeamId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("submissions_ibfk_2");

            entity.HasOne(d => d.User).WithMany(p => p.Submissions)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("submissions_ibfk_3");
        });

        modelBuilder.Entity<Tag>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("tags");

            entity.HasIndex(e => e.ChallengeId, "tags_ibfk_1");

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.ChallengeId)
                .HasColumnType("int(11)")
                .HasColumnName("challenge_id");
            entity.Property(e => e.Value)
                .HasMaxLength(80)
                .HasColumnName("value");

            entity.HasOne(d => d.Challenge).WithMany(p => p.Tags)
                .HasForeignKey(d => d.ChallengeId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("tags_ibfk_1");
        });

        modelBuilder.Entity<Team>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("teams");

            entity.HasIndex(e => e.Email, "email").IsUnique();

            entity.HasIndex(e => e.BracketId, "fk_teams_bracket_id");

            entity.HasIndex(e => new { e.Id, e.OauthId }, "id").IsUnique();

            entity.HasIndex(e => e.OauthId, "oauth_id").IsUnique();

            entity.HasIndex(e => e.CaptainId, "team_captain_id");

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.Affiliation)
                .HasMaxLength(128)
                .HasColumnName("affiliation");
            entity.Property(e => e.Banned).HasColumnName("banned");
            entity.Property(e => e.BracketId)
                .HasColumnType("int(11)")
                .HasColumnName("bracket_id");
            entity.Property(e => e.CaptainId)
                .HasColumnType("int(11)")
                .HasColumnName("captain_id");
            entity.Property(e => e.Country)
                .HasMaxLength(32)
                .HasColumnName("country");
            entity.Property(e => e.Created)
                .HasMaxLength(6)
                .HasColumnName("created");
            entity.Property(e => e.Email)
                .HasMaxLength(128)
                .HasColumnName("email");
            entity.Property(e => e.Hidden).HasColumnName("hidden");
            entity.Property(e => e.Name)
                .HasMaxLength(128)
                .HasColumnName("name");
            entity.Property(e => e.OauthId)
                .HasColumnType("int(11)")
                .HasColumnName("oauth_id");
            entity.Property(e => e.Password)
                .HasMaxLength(128)
                .HasColumnName("password");
            entity.Property(e => e.Secret)
                .HasMaxLength(128)
                .HasColumnName("secret");
            entity.Property(e => e.Website)
                .HasMaxLength(128)
                .HasColumnName("website");

            entity.HasOne(d => d.Bracket).WithMany(p => p.Teams)
                .HasForeignKey(d => d.BracketId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_teams_bracket_id");

            entity.HasOne(d => d.Captain).WithMany(p => p.Teams)
                .HasForeignKey(d => d.CaptainId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("team_captain_id");
        });

        modelBuilder.Entity<Ticket>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("tickets");

            entity.HasIndex(e => e.AuthorId, "author_id");

            entity.HasIndex(e => e.ReplierId, "replier_id");

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.AuthorId)
                .HasColumnType("int(11)")
                .HasColumnName("author_id");
            entity.Property(e => e.CreateAt)
                .HasMaxLength(6)
                .HasColumnName("create_at");
            entity.Property(e => e.Description)
                .HasColumnType("text")
                .HasColumnName("description");
            entity.Property(e => e.ReplierId)
                .HasColumnType("int(11)")
                .HasColumnName("replier_id");
            entity.Property(e => e.ReplierMessage)
                .HasColumnType("text")
                .HasColumnName("replier_message");
            entity.Property(e => e.Status)
                .HasMaxLength(80)
                .HasColumnName("status");
            entity.Property(e => e.Title)
                .HasMaxLength(255)
                .HasColumnName("title");
            entity.Property(e => e.Type)
                .HasMaxLength(80)
                .HasColumnName("type");

            entity.HasOne(d => d.Author).WithMany(p => p.TicketAuthors)
                .HasForeignKey(d => d.AuthorId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("tickets_ibfk_1");

            entity.HasOne(d => d.Replier).WithMany(p => p.TicketRepliers)
                .HasForeignKey(d => d.ReplierId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("tickets_ibfk_2");
        });

        modelBuilder.Entity<Token>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("tokens");

            entity.HasIndex(e => e.UserId, "user_id");

            entity.HasIndex(e => e.Value, "value").IsUnique();

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.Created)
                .HasMaxLength(6)
                .HasColumnName("created");
            entity.Property(e => e.Description)
                .HasColumnType("text")
                .HasColumnName("description");
            entity.Property(e => e.Expiration)
                .HasMaxLength(6)
                .HasColumnName("expiration");
            entity.Property(e => e.Type)
                .HasMaxLength(32)
                .HasColumnName("type");
            entity.Property(e => e.UserId)
                .HasColumnType("int(11)")
                .HasColumnName("user_id");
            entity.Property(e => e.Value)
                .HasColumnType("varchar")
                .HasColumnName("value");

            entity.HasOne(d => d.User).WithMany(p => p.Tokens)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("tokens_ibfk_1");
        });

        modelBuilder.Entity<Topic>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("topics");

            entity.HasIndex(e => e.Value, "value").IsUnique();

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.Value)
                .HasColumnType("varchar")
                .HasColumnName("value");
        });

        modelBuilder.Entity<Tracking>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("tracking");

            entity.HasIndex(e => e.UserId, "tracking_ibfk_1");

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.Date)
                .HasMaxLength(6)
                .HasColumnName("date");
            entity.Property(e => e.Ip)
                .HasMaxLength(46)
                .HasColumnName("ip");
            entity.Property(e => e.Type)
                .HasMaxLength(32)
                .HasColumnName("type");
            entity.Property(e => e.UserId)
                .HasColumnType("int(11)")
                .HasColumnName("user_id");

            entity.HasOne(d => d.User).WithMany(p => p.Trackings)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("tracking_ibfk_1");
        });

        modelBuilder.Entity<Unlock>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");
            entity.ToTable("unlocks");
            entity.HasIndex(e => e.ContestId, "ix_unlocks_contest_id");
            entity.HasIndex(e => e.TeamId, "unlocks_ibfk_1");
            entity.HasIndex(e => e.UserId, "unlocks_ibfk_2");

            entity.Property(e => e.Id).HasColumnType("int(11)").HasColumnName("id");
            entity.Property(e => e.ContestId).HasColumnType("int(11)").HasColumnName("contest_id");
            entity.Property(e => e.Date).HasMaxLength(6).HasColumnName("date");
            entity.Property(e => e.Target).HasColumnType("int(11)").HasColumnName("target");
            entity.Property(e => e.TeamId).HasColumnType("int(11)").HasColumnName("team_id");
            entity.Property(e => e.Type).HasMaxLength(32).HasColumnName("type");
            entity.Property(e => e.UserId).HasColumnType("int(11)").HasColumnName("user_id");

            entity.HasOne(d => d.Contest).WithMany(p => p.Unlocks)
                .HasForeignKey(d => d.ContestId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("unlocks_ibfk_contest");

            entity.HasOne(d => d.Team).WithMany(p => p.Unlocks)
                .HasForeignKey(d => d.TeamId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("unlocks_ibfk_1");

            entity.HasOne(d => d.User).WithMany(p => p.Unlocks)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("unlocks_ibfk_2");
        });

        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity.ToTable("users");

            entity.HasIndex(e => e.Email, "email").IsUnique();

            entity.HasIndex(e => e.BracketId, "fk_users_bracket_id");

            entity.HasIndex(e => e.TeamId, "fk_users_team_id");

            entity.HasIndex(e => new { e.Id, e.OauthId }, "id").IsUnique();

            entity.HasIndex(e => e.OauthId, "oauth_id").IsUnique();

            entity.Property(e => e.Id)
                .HasColumnType("int(11)")
                .HasColumnName("id");
            entity.Property(e => e.Affiliation)
                .HasMaxLength(128)
                .HasColumnName("affiliation");
            entity.Property(e => e.Banned).HasColumnName("banned");
            entity.Property(e => e.BracketId)
                .HasColumnType("int(11)")
                .HasColumnName("bracket_id");
            entity.Property(e => e.Country)
                .HasMaxLength(32)
                .HasColumnName("country");
            entity.Property(e => e.Created)
                .HasMaxLength(6)
                .HasColumnName("created");
            entity.Property(e => e.Email)
                .HasMaxLength(128)
                .HasColumnName("email");
            entity.Property(e => e.Hidden).HasColumnName("hidden");
            entity.Property(e => e.Language)
                .HasMaxLength(32)
                .HasColumnName("language");
            entity.Property(e => e.Name)
                .HasMaxLength(128)
                .HasColumnName("name");
            entity.Property(e => e.OauthId)
                .HasColumnType("int(11)")
                .HasColumnName("oauth_id");
            entity.Property(e => e.Password)
                .HasMaxLength(128)
                .HasColumnName("password");
            entity.Property(e => e.Secret)
                .HasMaxLength(128)
                .HasColumnName("secret");
            entity.Property(e => e.TeamId)
                .HasColumnType("int(11)")
                .HasColumnName("team_id");
            entity.Property(e => e.Type)
                .HasMaxLength(80)
                .HasColumnName("type");
            entity.Property(e => e.Verified).HasColumnName("verified");
            entity.Property(e => e.Website)
                .HasMaxLength(128)
                .HasColumnName("website");

            entity.HasOne(d => d.Bracket).WithMany(p => p.Users)
                .HasForeignKey(d => d.BracketId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_users_bracket_id");

            entity.HasOne(d => d.Team).WithMany(p => p.Users)
                .HasForeignKey(d => d.TeamId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_users_team_id");
        });

        OnModelCreatingPartial(modelBuilder);

        // =====================================================================
        // NEW ENTITIES — multiple-contest architecture
        // =====================================================================

        modelBuilder.Entity<Semester>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");
            entity.ToTable("semester");
            entity.HasIndex(e => e.SemesterName, "semester_name").IsUnique();
            entity.Property(e => e.Id).HasColumnType("int(11)").HasColumnName("id");
            entity.Property(e => e.SemesterName).HasMaxLength(128).HasColumnName("semester_name");
            entity.Property(e => e.StartTime).HasMaxLength(6).HasColumnName("start_time");
            entity.Property(e => e.EndTime).HasMaxLength(6).HasColumnName("end_time");
        });

        modelBuilder.Entity<Contest>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");
            entity.ToTable("contests");
            entity.HasIndex(e => e.Slug, "uq_contests_slug").IsUnique();
            entity.HasIndex(e => e.State, "ix_contests_state");

            entity.Property(e => e.Id).HasColumnType("int(11)").HasColumnName("id");
            entity.Property(e => e.Name).HasMaxLength(255).HasColumnName("name");
            entity.Property(e => e.Description).HasColumnType("text").HasColumnName("description");
            entity.Property(e => e.Slug).HasMaxLength(100).HasColumnName("slug");
            entity.Property(e => e.OwnerId).HasColumnType("int(11)").HasColumnName("owner_id");
            entity.Property(e => e.SemesterName).HasMaxLength(128).HasColumnName("semester_name");
            entity.Property(e => e.State).HasMaxLength(20).HasDefaultValueSql("'draft'").HasColumnName("state");
            entity.Property(e => e.UserMode).HasMaxLength(20).HasDefaultValueSql("'users'").HasColumnName("user_mode");
            entity.Property(e => e.StartTime).HasMaxLength(6).HasColumnName("start_time");
            entity.Property(e => e.EndTime).HasMaxLength(6).HasColumnName("end_time");
            entity.Property(e => e.FreezeScoreboardAt).HasMaxLength(6).HasColumnName("freeze_scoreboard_at");
            entity.Property(e => e.CreatedAt).HasMaxLength(6).HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt).HasMaxLength(6).HasColumnName("updated_at");

            entity.HasOne(d => d.Owner).WithMany(p => p.OwnedContests)
                .HasForeignKey(d => d.OwnerId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("contests_ibfk_owner");

            entity.HasOne(d => d.Semester).WithMany(p => p.Contests)
                .HasForeignKey(d => d.SemesterName)
                .HasPrincipalKey(s => s.SemesterName)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("contests_ibfk_semester");
        });

        modelBuilder.Entity<ContestParticipant>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");
            entity.ToTable("contest_participants");
            entity.HasIndex(e => new { e.ContestId, e.UserId }, "uq_contest_participants_contest_user").IsUnique();

            entity.Property(e => e.Id).HasColumnType("int(11)").HasColumnName("id");
            entity.Property(e => e.ContestId).HasColumnType("int(11)").HasColumnName("contest_id");
            entity.Property(e => e.UserId).HasColumnType("int(11)").HasColumnName("user_id");
            entity.Property(e => e.TeamId).HasColumnType("int(11)").HasColumnName("team_id");
            entity.Property(e => e.Role).HasMaxLength(20).HasDefaultValueSql("'contestant'").HasColumnName("role");
            entity.Property(e => e.Score).HasColumnType("int(11)").HasDefaultValue(0).HasColumnName("score");
            entity.Property(e => e.JoinedAt).HasMaxLength(6).HasColumnName("joined_at");
            entity.Property(e => e.LastSolveAt).HasMaxLength(6).HasColumnName("last_solve_at");

            entity.HasOne(d => d.Contest).WithMany(p => p.Participants)
                .HasForeignKey(d => d.ContestId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("cp_ibfk_contest");

            entity.HasOne(d => d.User).WithMany(p => p.ContestParticipations)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("cp_ibfk_user");

            entity.HasOne(d => d.Team).WithMany()
                .HasForeignKey(d => d.TeamId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("cp_ibfk_team");
        });

        modelBuilder.Entity<ContestsChallenge>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");
            entity.ToTable("contests_challenges");
            entity.HasIndex(e => e.ContestId, "ix_cc_contest_id");
            entity.HasIndex(e => e.BankId, "ix_cc_bank_id");

            entity.Property(e => e.Id).HasColumnType("int(11)").HasColumnName("id");
            entity.Property(e => e.ContestId).HasColumnType("int(11)").HasColumnName("contest_id");
            entity.Property(e => e.BankId).HasColumnType("int(11)").HasColumnName("bank_id");
            entity.Property(e => e.Name).HasMaxLength(80).HasColumnName("name");
            entity.Property(e => e.ConnectionInfo).HasColumnType("text").HasColumnName("connection_info");
            entity.Property(e => e.NextId).HasColumnType("int(11)").HasColumnName("next_id");
            entity.Property(e => e.MaxAttempts).HasColumnType("int(11)").HasDefaultValue(0).HasColumnName("max_attempts");
            entity.Property(e => e.Value).HasColumnType("int(11)").HasColumnName("value");
            entity.Property(e => e.State).HasMaxLength(80).HasDefaultValueSql("'visible'").HasColumnName("state");
            entity.Property(e => e.TimeLimit).HasColumnType("int(11)").HasColumnName("time_limit");
            entity.Property(e => e.StartTime).HasMaxLength(6).HasColumnName("start_time");
            entity.Property(e => e.TimeFinished).HasMaxLength(6).HasColumnName("time_finished");
            entity.Property(e => e.Cooldown).HasColumnType("int(11)").HasDefaultValue(0).HasColumnName("cooldown");
            entity.Property(e => e.RequireDeploy).HasColumnName("require_deploy").HasDefaultValue(false);
            entity.Property(e => e.DeployStatus).HasColumnType("text").HasDefaultValueSql("'CREATED'").HasColumnName("deploy_status");
            entity.Property(e => e.LastUpdate).HasMaxLength(6).HasColumnName("last_update");
            entity.Property(e => e.MaxDeployCount).HasColumnType("int(11)").HasDefaultValue(0).HasColumnName("max_deploy_count");
            entity.Property(e => e.ConnectionProtocol).HasMaxLength(10).HasDefaultValueSql("'http'").HasColumnName("connection_protocol");
            entity.Property(e => e.UserId).HasColumnType("int(11)").HasColumnName("user_id");

            entity.HasOne(d => d.Contest).WithMany(p => p.ContestsChallenges)
                .HasForeignKey(d => d.ContestId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("cc_ibfk_contest");

            entity.HasOne(d => d.BankChallenge).WithMany(p => p.ContestInstances)
                .HasForeignKey(d => d.BankId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("cc_ibfk_bank");

            entity.HasOne(d => d.Next).WithMany(p => p.InverseNext)
                .HasForeignKey(d => d.NextId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("cc_ibfk_next");

            entity.HasOne(d => d.Creator).WithMany(p => p.DeployedContestChallenges)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("cc_ibfk_user");
        });
    }

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder);
}
